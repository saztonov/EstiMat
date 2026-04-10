import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createEstimateSchema, updateEstimateSchema, createEstimateItemSchema, updateEstimateItemSchema } from '@estimat/shared';

export default async function estimateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/estimates?projectId=
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    let query = `SELECT e.*, p.code as project_code, p.name as project_name, o.name as contractor_name
                 FROM estimates e
                 JOIN projects p ON e.project_id = p.id
                 LEFT JOIN organizations o ON e.contractor_id = o.id`;
    const values: string[] = [];
    if (projectId) {
      query += ' WHERE e.project_id = $1';
      values.push(projectId);
    }
    query += ' ORDER BY e.created_at DESC';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // GET /api/estimates/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT e.*, p.code as project_code, p.name as project_name, o.name as contractor_name
       FROM estimates e
       JOIN projects p ON e.project_id = p.id
       LEFT JOIN organizations o ON e.contractor_id = o.id
       WHERE e.id = $1`,
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Смета не найдена' });

    // Load items
    const items = await fastify.pool.query(
      `SELECT ei.*, r.name as rate_name, r.code as rate_code
       FROM estimate_items ei
       LEFT JOIN rates r ON ei.rate_id = r.id
       WHERE ei.estimate_id = $1
       ORDER BY ei.sort_order`,
      [request.params.id],
    );

    return { data: { ...rows[0], items: items.rows } };
  });

  // POST /api/estimates
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = createEstimateSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO estimates (project_id, contractor_id, work_type, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.projectId, body.contractorId || null, body.workType || null, body.notes || null, request.currentUser.id],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/estimates/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateEstimateSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.projectId !== undefined) { sets.push(`project_id = $${i++}`); values.push(body.projectId); }
    if (body.contractorId !== undefined) { sets.push(`contractor_id = $${i++}`); values.push(body.contractorId); }
    if (body.workType !== undefined) { sets.push(`work_type = $${i++}`); values.push(body.workType); }
    if (body.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(body.notes); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE estimates SET ${sets.join(', ')} WHERE id = $${i} AND status = 'draft' RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Смета не найдена или не в статусе черновик' });
    return { data: rows[0] };
  });

  // PUT /api/estimates/:id/status
  fastify.put<{ Params: { id: string } }>('/:id/status', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const { status } = request.body as { status: string };
    const updates = status === 'approved'
      ? 'status = $1, approved_by = $2, approved_at = now()'
      : 'status = $1';
    const values = status === 'approved'
      ? [status, request.currentUser.id, request.params.id]
      : [status, request.params.id];
    const paramIdx = status === 'approved' ? 3 : 2;

    const { rows } = await fastify.pool.query(
      `UPDATE estimates SET ${updates} WHERE id = $${paramIdx} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Смета не найдена' });

    // Audit log for status changes
    await fastify.pool.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes)
       VALUES ('estimate', $1, $2, $3, $4)`,
      [request.params.id, `status_changed_to_${status}`, request.currentUser.id, JSON.stringify({ status })],
    );

    return { data: rows[0] };
  });

  // === Estimate Items ===

  // POST /api/estimates/:id/items
  fastify.post<{ Params: { id: string } }>('/:id/items', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createEstimateItemSchema.parse({ ...request.body as object, estimateId: request.params.id });
    const { rows } = await fastify.pool.query(
      `INSERT INTO estimate_items (estimate_id, rate_id, description, quantity, unit, unit_price, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [body.estimateId, body.rateId || null, body.description, body.quantity, body.unit, body.unitPrice, body.sortOrder],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/estimates/items/:id
  fastify.put<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateEstimateItemSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.rateId !== undefined) { sets.push(`rate_id = $${i++}`); values.push(body.rateId); }
    if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); }
    if (body.quantity !== undefined) { sets.push(`quantity = $${i++}`); values.push(body.quantity); }
    if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); }
    if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); }
    if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE estimate_items SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Позиция не найдена' });
    return { data: rows[0] };
  });

  // DELETE /api/estimates/items/:id
  fastify.delete<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM estimate_items WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Позиция не найдена' });
    return { success: true };
  });
}
