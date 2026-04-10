import type { FastifyRequest, FastifyReply } from 'fastify';
import { LRUCache } from 'lru-cache';
import type { RequestUser } from '../types/fastify.js';

const userCache = new LRUCache<string, RequestUser>({
  max: 500,
  ttl: 15_000, // 15 seconds
});

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies['access_token'];
  if (!token) {
    return reply.status(401).send({ error: 'Не авторизован' });
  }

  try {
    const payload = request.server.jwt.verify<{ sub: string; exp: number }>(token);
    const userId = payload.sub;
    request.accessTokenExp = payload.exp;

    // Check cache first
    const cached = userCache.get(userId);
    if (cached) {
      request.currentUser = cached;
      return;
    }

    // Load from DB
    const result = await request.server.pool.query(
      `SELECT id, email, full_name, org_id, role, is_active
       FROM users WHERE id = $1`,
      [userId],
    );

    const row = result.rows[0];
    if (!row) {
      return reply.status(401).send({ error: 'Пользователь не найден' });
    }
    if (!row.is_active) {
      return reply.status(401).send({ error: 'Аккаунт деактивирован' });
    }

    const user: RequestUser = {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      orgId: row.org_id,
      role: row.role,
      isActive: row.is_active,
    };

    userCache.set(userId, user);
    request.currentUser = user;
  } catch {
    return reply.status(401).send({ error: 'Невалидный токен' });
  }
}
