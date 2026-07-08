import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import { createRdCipherSchema, updateRdCipherSchema } from '@estimat/shared';

const CIPHER_SELECT = 'id, project_id, code, created_at, updated_at';

// Справочник шифров рабочей документации объекта (project_rd_ciphers).
// Все запросы фильтруют WHERE project_id = $1 — чужой объект не затронуть.
export function registerCipherRoutes(fastify: FastifyInstance): void {
  // GET /api/projects/:id/ciphers — список шифров объекта (алфавитно по code).
  fastify.get<{ Params: { id: string } }>('/:id/ciphers', async (request) => {
    const { rows } = await fastify.pool.query(
      `SELECT ${CIPHER_SELECT} FROM project_rd_ciphers WHERE project_id = $1 ORDER BY code`,
      [request.params.id],
    );
    return { data: rows };
  });

  // POST /api/projects/:id/ciphers — создать шифр (unique_violation → 409 в глобальном обработчике).
  fastify.post<{ Params: { id: string } }>(
    '/:id/ciphers',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = createRdCipherSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO project_rd_ciphers (project_id, code) VALUES ($1, $2) RETURNING ${CIPHER_SELECT}`,
        [request.params.id, body.code],
      );
      return reply.status(201).send({ data: rows[0] });
    },
  );

  // PUT /api/projects/:id/ciphers/:cipherId — переименовать шифр.
  fastify.put<{ Params: { id: string; cipherId: string } }>(
    '/:id/ciphers/:cipherId',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = updateRdCipherSchema.parse(request.body);
      if (body.code === undefined) return reply.status(400).send({ error: 'Нет данных для обновления' });
      const { rows } = await fastify.pool.query(
        `UPDATE project_rd_ciphers SET code = $1 WHERE id = $2 AND project_id = $3 RETURNING ${CIPHER_SELECT}`,
        [body.code, request.params.cipherId, request.params.id],
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Шифр не найден' });
      return { data: rows[0] };
    },
  );

  // DELETE /api/projects/:id/ciphers/:cipherId — удалить шифр (связки с видами работ каскадом).
  fastify.delete<{ Params: { id: string; cipherId: string } }>(
    '/:id/ciphers/:cipherId',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const { rowCount } = await fastify.pool.query(
        'DELETE FROM project_rd_ciphers WHERE id = $1 AND project_id = $2',
        [request.params.cipherId, request.params.id],
      );
      if (rowCount === 0) return reply.status(404).send({ error: 'Шифр не найден' });
      return { success: true };
    },
  );
}
