import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createMaterialGroupSchema, createMaterialSchema, updateMaterialSchema } from '@estimat/shared';

export default async function materialRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // === Material Groups ===

  // GET /api/materials/groups
  fastify.get('/groups', async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM material_groups ORDER BY name',
    );
    return { data: rows };
  });

  // POST /api/materials/groups
  fastify.post('/groups', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createMaterialGroupSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO material_groups (name, parent_id, code)
       VALUES ($1, $2, $3) RETURNING *`,
      [body.name, body.parentId || null, body.code || null],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // DELETE /api/materials/groups/:id
  fastify.delete<{ Params: { id: string } }>('/groups/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM material_groups WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Группа не найдена' });
    return { success: true };
  });

  // === Materials ===

  // GET /api/materials
  fastify.get('/', async (request) => {
    const { groupId } = request.query as { groupId?: string };
    let query = 'SELECT mc.*, mg.name as group_name FROM material_catalog mc LEFT JOIN material_groups mg ON mc.group_id = mg.id';
    const values: string[] = [];
    if (groupId) {
      query += ' WHERE mc.group_id = $1';
      values.push(groupId);
    }
    query += ' ORDER BY mc.name';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // GET /api/materials/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM material_catalog WHERE id = $1',
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
    return { data: rows[0] };
  });

  // POST /api/materials
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createMaterialSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO material_catalog (name, group_id, unit, unit_price, description, attributes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.name, body.groupId || null, body.unit, body.unitPrice ?? 0, body.description || null, JSON.stringify(body.attributes || {})],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/materials/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateMaterialSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.groupId !== undefined) { sets.push(`group_id = $${i++}`); values.push(body.groupId); }
    if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); }
    if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); }
    if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); }
    if (body.attributes !== undefined) { sets.push(`attributes = $${i++}`); values.push(JSON.stringify(body.attributes)); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE material_catalog SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
    return { data: rows[0] };
  });
}
