import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createUserSchema, updateUserSchema, changePasswordSchema } from '@estimat/shared';

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/users
  fastify.get('/', { preHandler: [requireRole('admin')] }, async () => {
    const { rows } = await fastify.pool.query(
      `SELECT u.id, u.email, u.full_name, u.org_id, u.role, u.phone, u.is_active,
              u.created_at, u.updated_at, o.name as org_name
       FROM users u
       LEFT JOIN organizations o ON u.org_id = o.id
       ORDER BY u.full_name`,
    );
    return { data: rows };
  });

  // POST /api/users
  fastify.post('/', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = createUserSchema.parse(request.body);

    const existing = await fastify.pool.query(
      'SELECT id FROM users WHERE email = $1',
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
        'SELECT id FROM users WHERE email = $1 AND id != $2',
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
    const { rows } = await fastify.pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, email, full_name, org_id, role, phone, is_active`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Пользователь не найден' });
    return { data: rows[0] };
  });

  // DELETE /api/users/:id (soft delete)
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    if (request.params.id === request.currentUser.id) {
      return reply.status(400).send({ error: 'Нельзя деактивировать самого себя' });
    }

    const { rowCount } = await fastify.pool.query(
      'UPDATE users SET is_active = false WHERE id = $1 AND is_active = true',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Пользователь не найден или уже деактивирован' });
    return { success: true };
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
