import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createRoomTypeSchema, updateRoomTypeSchema } from '@estimat/shared';

// Глобальный справочник типов помещений (квартира, МОП, лестничная клетка и т.п.).
export default async function roomTypeRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/room-types?activeOnly=1
  fastify.get<{ Querystring: { activeOnly?: string } }>('/', async (request) => {
    const activeOnly = request.query.activeOnly === '1' || request.query.activeOnly === 'true';
    const { rows } = await fastify.pool.query(
      `SELECT * FROM room_types ${activeOnly ? 'WHERE is_active = true' : ''} ORDER BY sort_order, name`,
    );
    return { data: rows };
  });

  // POST /api/room-types
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = createRoomTypeSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO room_types (name, code, sort_order, is_active) VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.name, body.code ?? null, body.sortOrder ?? 0, body.isActive ?? true],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/room-types/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateRoomTypeSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code); }
    if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }
    if (body.isActive !== undefined) { sets.push(`is_active = $${i++}`); values.push(body.isActive); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE room_types SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Тип помещения не найден' });
    return { data: rows[0] };
  });

  // DELETE /api/room-types/:id (FK ON DELETE SET NULL обнулит room_type_id у строк)
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM room_types WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Тип помещения не найден' });
    return { success: true };
  });
}
