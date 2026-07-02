import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { authenticate, invalidateUserCache } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../lib/audit.js';
import { createUserSchema, updateUserSchema, changePasswordSchema } from '@estimat/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/users
  fastify.get('/', { preHandler: [requireRole('admin')] }, async () => {
    const { rows } = await fastify.pool.query(
      `SELECT u.id, u.email, u.full_name, u.org_id, u.role, u.phone, u.is_active,
              u.created_at, u.updated_at, o.name as org_name
       FROM users u
       LEFT JOIN organizations o ON u.org_id = o.id
       ORDER BY u.created_at DESC`,
    );
    return { data: rows };
  });

  // POST /api/users
  fastify.post('/', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = createUserSchema.parse(request.body);

    const existing = await fastify.pool.query(
      'SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim($1))',
      [body.email],
    );
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Пользователь с таким email уже существует' });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const { rows } = await fastify.pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, org_id, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, full_name, org_id, role, phone, is_active`,
      [body.email, passwordHash, body.fullName, body.role, body.orgId || null, body.phone || null],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/users/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = updateUserSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.email !== undefined) {
      const dup = await fastify.pool.query(
        'SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim($1)) AND id != $2',
        [body.email, request.params.id],
      );
      if (dup.rows.length > 0) {
        return reply.status(409).send({ error: 'Email уже используется' });
      }
      sets.push(`email = $${i++}`);
      values.push(body.email);
    }
    if (body.fullName !== undefined) { sets.push(`full_name = $${i++}`); values.push(body.fullName); }
    if (body.role !== undefined) { sets.push(`role = $${i++}`); values.push(body.role); }
    if (body.orgId !== undefined) { sets.push(`org_id = $${i++}`); values.push(body.orgId); }
    if (body.phone !== undefined) { sets.push(`phone = $${i++}`); values.push(body.phone); }
    if (body.isActive !== undefined) { sets.push(`is_active = $${i++}`); values.push(body.isActive); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const updateSql = `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, email, full_name, org_id, role, phone, is_active`;

    // Обычный апдейт (email/ФИО/телефон/орг) — без транзакции.
    const touchesPrivilege = body.isActive !== undefined || body.role !== undefined;
    if (!touchesPrivilege) {
      const { rows } = await fastify.pool.query(updateSql, values);
      if (rows.length === 0) return reply.status(404).send({ error: 'Пользователь не найден' });
      // Кэш пользователя (authenticate) держит email/ФИО/оргу — сбрасываем, чтобы /auth/me
      // отдавал новые данные сразу, а не через TTL (иначе до 15с окно устаревших значений).
      invalidateUserCache(request.params.id);
      return { data: rows[0] };
    }

    // Изменение активности/роли защищаем инвариантом «остаётся ≥1 активный админ»
    // (иначе тумблером «Активен»/сменой роли можно обойти защиту из DELETE).
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: targetRows } = await client.query(
        'SELECT role, is_active FROM users WHERE id = $1',
        [request.params.id],
      );
      if (targetRows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Пользователь не найден' });
      }
      const target = targetRows[0];
      const newRole = body.role ?? target.role;
      const newActive = body.isActive ?? target.is_active;
      const wasActiveAdmin = target.role === 'admin' && target.is_active === true;
      const willBeActiveAdmin = newRole === 'admin' && newActive === true;
      if (wasActiveAdmin && !willBeActiveAdmin) {
        const { rows: admins } = await client.query(
          "SELECT id FROM users WHERE role = 'admin' AND is_active = true ORDER BY id FOR UPDATE",
        );
        const otherActiveAdmins = admins.filter((a) => a.id !== request.params.id).length;
        if (otherActiveAdmins === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Нельзя деактивировать или разжаловать последнего администратора' });
        }
      }
      const { rows } = await client.query(updateSql, values);
      await client.query('COMMIT');
      invalidateUserCache(request.params.id);
      return { data: rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // DELETE /api/users/:id (hard delete — необратимо)
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) {
      return reply.status(400).send({ error: 'Некорректный идентификатор пользователя' });
    }
    if (id === request.currentUser.id) {
      return reply.status(400).send({ error: 'Нельзя удалить самого себя' });
    }

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: targetRows } = await client.query(
        'SELECT role, email, full_name, is_active FROM users WHERE id = $1',
        [id],
      );
      if (targetRows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Пользователь не найден' });
      }
      const target = targetRows[0];

      // Инвариант «остаётся ≥1 активный админ»: не удалять последнего активного администратора.
      // ORDER BY id FOR UPDATE сериализует параллельные удаления/деактивации админов без deadlock.
      if (target.role === 'admin' && target.is_active === true) {
        const { rows: admins } = await client.query(
          "SELECT id FROM users WHERE role = 'admin' AND is_active = true ORDER BY id FOR UPDATE",
        );
        const otherActiveAdmins = admins.filter((a) => a.id !== id).length;
        if (otherActiveAdmins === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Нельзя удалить последнего администратора' });
        }
      }

      // Фиксируем факт удаления в журнале (без пароля/хеша) до самого DELETE.
      await recordAudit(client, {
        estimateId: null,
        entityType: 'user',
        entityId: id,
        action: 'user.delete',
        userId: request.currentUser.id,
        changes: { email: target.email, fullName: target.full_name, role: target.role },
      });

      await client.query('DELETE FROM users WHERE id = $1', [id]);
      await client.query('COMMIT');
      invalidateUserCache(id);
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // PUT /api/users/:id/password
  fastify.put<{ Params: { id: string } }>('/:id/password', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.newPassword, 10);

    const { rowCount } = await fastify.pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Пользователь не найден' });
    return { success: true };
  });
}
