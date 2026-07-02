import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { config } from '../../config.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loginSchema, registerSchema, selfChangePasswordSchema } from '@estimat/shared';

function accessTokenCookie(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    // Раздельные домены SPA/API (estimat.* и api.*): для кросс-origin XHR cookie
    // нужен SameSite=None; Secure. В dev (http, один origin) — lax.
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge: config.jwt.accessTtl,
  };
}

function refreshTokenCookie(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    // Раздельные домены SPA/API (estimat.* и api.*): для кросс-origin XHR cookie
    // нужен SameSite=None; Secure. В dev (http, один origin) — lax.
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api/auth/refresh',
    maxAge: config.jwt.refreshTtl,
  };
}

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    // Check if user exists
    const existing = await fastify.pool.query(
      'SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim($1))',
      [body.email],
    );
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Пользователь с таким email уже существует' });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    // Самостоятельная регистрация создаёт неактивного пользователя — вход возможен
    // только после того, как администратор включит ему флаг is_active.
    await fastify.pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role, is_active)
       VALUES ($1, $2, $3, $4, 'engineer', false)`,
      [body.email, passwordHash, body.fullName, body.phone || null],
    );

    // Токены не выдаём — пользователь не авторизуется до активации администратором.
    return reply.status(201).send({ pendingActivation: true });
  });

  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const result = await fastify.pool.query(
      `SELECT id, email, password_hash, full_name, org_id, role, is_active
       FROM users WHERE lower(btrim(email)) = lower(btrim($1))`,
      [body.email],
    );

    const user = result.rows[0];
    if (!user) {
      return reply.status(401).send({ error: 'Неверный email или пароль' });
    }

    if (!user.is_active) {
      return reply.status(401).send({ error: 'Аккаунт ещё не активирован администратором' });
    }

    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Неверный email или пароль' });
    }

    const accessToken = fastify.jwt.sign(
      { sub: user.id, role: user.role },
      { expiresIn: config.jwt.accessTtl },
    );
    const refreshToken = fastify.jwt.sign(
      { sub: user.id, type: 'refresh' },
      { expiresIn: config.jwt.refreshTtl, key: config.jwt.refreshSecret },
    );

    reply
      .setCookie('access_token', accessToken, accessTokenCookie(config.isProduction))
      .setCookie('refresh_token', refreshToken, refreshTokenCookie(config.isProduction));

    const decoded = fastify.jwt.decode<{ exp: number }>(accessToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        orgId: user.org_id,
        role: user.role,
        isActive: user.is_active,
      },
      accessTokenExpiresAt: decoded ? decoded.exp * 1000 : 0,
    };
  });

  // POST /api/auth/refresh
  fastify.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies['refresh_token'];
    if (!refreshToken) {
      return reply.status(401).send({ error: 'Refresh token отсутствует' });
    }

    try {
      const payload = fastify.jwt.verify<{ sub: string }>(refreshToken, {
        key: config.jwt.refreshSecret,
      });

      // Load user to verify still active
      const result = await fastify.pool.query(
        'SELECT id, role, is_active FROM users WHERE id = $1',
        [payload.sub],
      );
      const user = result.rows[0];
      if (!user || !user.is_active) {
        reply
          .clearCookie('access_token', { path: '/' })
          .clearCookie('refresh_token', { path: '/api/auth/refresh' });
        return reply.status(401).send({ error: 'Пользователь не найден или деактивирован' });
      }

      const newAccessToken = fastify.jwt.sign(
        { sub: user.id, role: user.role },
        { expiresIn: config.jwt.accessTtl },
      );
      const newRefreshToken = fastify.jwt.sign(
        { sub: user.id, type: 'refresh' },
        { expiresIn: config.jwt.refreshTtl, key: config.jwt.refreshSecret },
      );

      reply
        .setCookie('access_token', newAccessToken, accessTokenCookie(config.isProduction))
        .setCookie('refresh_token', newRefreshToken, refreshTokenCookie(config.isProduction));

      const decoded = fastify.jwt.decode<{ exp: number }>(newAccessToken);

      return {
        success: true,
        accessTokenExpiresAt: decoded ? decoded.exp * 1000 : 0,
      };
    } catch {
      reply
        .clearCookie('access_token', { path: '/' })
        .clearCookie('refresh_token', { path: '/api/auth/refresh' });
      return reply.status(401).send({ error: 'Невалидный refresh token' });
    }
  });

  // POST /api/auth/logout
  fastify.post('/logout', async (_request, reply) => {
    reply
      .clearCookie('access_token', { path: '/' })
      .clearCookie('refresh_token', { path: '/api/auth/refresh' });
    return { success: true };
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [authenticate] }, async (request) => {
    return { user: request.currentUser };
  });

  // POST /api/auth/change-password — смена своего пароля (с проверкой текущего)
  fastify.post('/change-password', { preHandler: [authenticate] }, async (request, reply) => {
    const body = selfChangePasswordSchema.parse(request.body);
    const userId = request.currentUser!.id;

    const { rows } = await fastify.pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    const valid = await bcrypt.compare(body.currentPassword, rows[0].password_hash);
    if (!valid) {
      return reply.status(400).send({ error: 'Текущий пароль указан неверно' });
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 10);
    await fastify.pool.query(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [passwordHash, userId],
    );
    return { success: true };
  });
}
