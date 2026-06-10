import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createUnitSchema, updateUnitSchema } from '@estimat/shared';

export default async function unitRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/units
  fastify.get('/', async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM units ORDER BY sort_order, name',
    );
    return { data: rows };
  });

  // POST /api/units
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createUnitSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO units (name, sort_order) VALUES ($1, $2) RETURNING *`,
      [body.name, body.sortOrder ?? 0],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/units/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateUnitSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE units SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Единица не найдена' });
    return { data: rows[0] };
  });

  // DELETE /api/units/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM units WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Единица не найдена' });
    return { success: true };
  });
}
