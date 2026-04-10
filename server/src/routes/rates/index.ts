import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createCostCategorySchema, createCostTypeSchema, createRateSchema, updateRateSchema } from '@estimat/shared';

export default async function rateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // === Cost Categories ===

  // GET /api/rates/categories
  fastify.get('/categories', async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM cost_categories ORDER BY sort_order, name',
    );
    return { data: rows };
  });

  // POST /api/rates/categories
  fastify.post('/categories', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createCostCategorySchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO cost_categories (name, code, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [body.name, body.code || null, body.sortOrder],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // DELETE /api/rates/categories/:id (каскадное удаление видов и расценок)
  fastify.delete<{ Params: { id: string } }>('/categories/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM cost_categories WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Категория не найдена' });
    return { success: true };
  });

  // === Cost Types ===

  // GET /api/rates/types?categoryId=
  fastify.get('/types', async (request) => {
    const { categoryId } = request.query as { categoryId?: string };
    let query = 'SELECT * FROM cost_types';
    const values: string[] = [];
    if (categoryId) {
      query += ' WHERE category_id = $1';
      values.push(categoryId);
    }
    query += ' ORDER BY sort_order, name';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // POST /api/rates/types
  fastify.post('/types', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createCostTypeSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO cost_types (category_id, name, code, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.categoryId, body.name, body.code || null, body.sortOrder],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // DELETE /api/rates/types/:id (каскадное удаление расценок)
  fastify.delete<{ Params: { id: string } }>('/types/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM cost_types WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Вид затрат не найден' });
    return { success: true };
  });

  // === Rates ===

  // GET /api/rates?costTypeId=
  fastify.get('/', async (request) => {
    const { costTypeId } = request.query as { costTypeId?: string };
    let query = `SELECT r.*, ct.name as cost_type_name, cc.name as category_name
                 FROM rates r
                 JOIN cost_types ct ON r.cost_type_id = ct.id
                 JOIN cost_categories cc ON ct.category_id = cc.id`;
    const values: string[] = [];
    if (costTypeId) {
      query += ' WHERE r.cost_type_id = $1';
      values.push(costTypeId);
    }
    query += ' ORDER BY r.name';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // GET /api/rates/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM rates WHERE id = $1',
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Расценка не найдена' });
    return { data: rows[0] };
  });

  // POST /api/rates
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createRateSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO rates (cost_type_id, name, code, unit, price, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.costTypeId, body.name, body.code || null, body.unit, body.price, body.description || null],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/rates/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateRateSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code); }
    if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); }
    if (body.price !== undefined) { sets.push(`price = $${i++}`); values.push(body.price); }
    if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE rates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Расценка не найдена' });
    return { data: rows[0] };
  });

  // GET /api/rates/tree — полное дерево: категории → виды → расценки
  fastify.get('/tree', async () => {
    const categories = await fastify.pool.query('SELECT * FROM cost_categories ORDER BY sort_order, name');
    const types = await fastify.pool.query('SELECT * FROM cost_types ORDER BY sort_order, name');
    const rates = await fastify.pool.query('SELECT * FROM rates WHERE is_active = true ORDER BY name');

    const tree = categories.rows.map((cat: Record<string, unknown>) => ({
      ...cat,
      types: types.rows
        .filter((t: Record<string, unknown>) => t.category_id === cat.id)
        .map((t: Record<string, unknown>) => ({
          ...t,
          rates: rates.rows.filter((r: Record<string, unknown>) => r.cost_type_id === t.id),
        })),
    }));

    return { data: tree };
  });
}
