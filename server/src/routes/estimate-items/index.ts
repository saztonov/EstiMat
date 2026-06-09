import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  estimateItemsQuerySchema,
  createEstimateMaterialSchema,
  updateEstimateMaterialSchema,
} from '@estimat/shared';

export default async function estimateItemsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/estimate-items — реестр строк (работ) по всем объектам с компонуемыми фильтрами
  fastify.get('/', async (request, reply) => {
    const parsed = estimateItemsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Некорректные параметры запроса' });
    }
    const q = parsed.data;

    const conds: string[] = [];
    const values: unknown[] = [];
    const add = (frag: (idx: number) => string, val: unknown) => {
      values.push(val);
      conds.push(frag(values.length));
    };

    if (q.projectId) add((i) => `ei.project_id = $${i}`, q.projectId);
    if (q.costCategoryId) add((i) => `ei.cost_category_id = $${i}`, q.costCategoryId);
    if (q.costTypeId) add((i) => `ei.cost_type_id = $${i}`, q.costTypeId);
    if (q.contractorId) add((i) => `ec.contractor_id = $${i}`, q.contractorId);
    if (q.materialId) {
      add(
        (i) => `EXISTS (SELECT 1 FROM estimate_materials em2 WHERE em2.item_id = ei.id AND em2.material_id = $${i})`,
        q.materialId,
      );
    }
    if (q.search) add((i) => `ei.description ILIKE $${i}`, `%${q.search}%`);

    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // Подсчёт total с теми же фильтрами (ec нужен для фильтра по подрядчику)
    const countRes = await fastify.pool.query(
      `SELECT COUNT(*)::int AS total
       FROM estimate_items ei
       LEFT JOIN estimate_contractors ec ON ec.estimate_id = ei.estimate_id AND ec.cost_type_id = ei.cost_type_id
       ${whereSql}`,
      values,
    );
    const total: number = countRes.rows[0]?.total ?? 0;

    const sortCols: Record<string, string> = {
      project_code: 'p.code',
      description: 'ei.description',
      total: 'ei.total',
      created_at: 'ei.created_at',
    };
    const sortCol = sortCols[q.sortBy] ?? 'p.code';
    const dir = q.sortDir === 'desc' ? 'DESC' : 'ASC';
    const orderSql = `ORDER BY ${sortCol} ${dir}, ei.sort_order, ei.created_at`;

    const dataValues = [...values, q.pageSize, (q.page - 1) * q.pageSize];
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;

    const { rows } = await fastify.pool.query(
      `SELECT ei.id, ei.estimate_id, ei.project_id, ei.cost_category_id, ei.cost_type_id,
              ei.rate_id, ei.description, ei.quantity, ei.unit, ei.unit_price, ei.total,
              ei.sort_order, ei.created_at,
              p.code  AS project_code,
              p.name  AS project_name,
              cc.name AS cost_category_name,
              ct.name AS cost_type_name,
              r.code  AS rate_code,
              ec.contractor_id,
              o.name  AS contractor_name,
              COALESCE(m.materials, '[]'::json) AS materials
       FROM estimate_items ei
       LEFT JOIN projects p          ON ei.project_id = p.id
       LEFT JOIN cost_categories cc  ON ei.cost_category_id = cc.id
       LEFT JOIN cost_types ct       ON ei.cost_type_id = ct.id
       LEFT JOIN rates r             ON ei.rate_id = r.id
       LEFT JOIN estimate_contractors ec ON ec.estimate_id = ei.estimate_id AND ec.cost_type_id = ei.cost_type_id
       LEFT JOIN organizations o     ON ec.contractor_id = o.id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'id', em.id,
                  'item_id', em.item_id,
                  'material_id', em.material_id,
                  'description', em.description,
                  'quantity', em.quantity,
                  'unit', em.unit,
                  'unit_price', em.unit_price,
                  'total', em.total,
                  'material_name', mc.name
                ) ORDER BY em.sort_order, em.created_at) AS materials
         FROM estimate_materials em
         LEFT JOIN material_catalog mc ON em.material_id = mc.id
         WHERE em.item_id = ei.id
       ) m ON true
       ${whereSql}
       ${orderSql}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataValues,
    );

    return { data: rows, pagination: { page: q.page, pageSize: q.pageSize, total } };
  });

  // === Материалы (под работой) ===

  // POST /api/estimate-items/:itemId/materials — добавить материал к работе
  fastify.post<{ Params: { itemId: string } }>(
    '/:itemId/materials',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rows: work } = await fastify.pool.query(
        'SELECT estimate_id FROM estimate_items WHERE id = $1',
        [request.params.itemId],
      );
      if (work.length === 0) return reply.status(404).send({ error: 'Работа не найдена' });

      const body = createEstimateMaterialSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO estimate_materials
           (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          request.params.itemId,
          work[0].estimate_id,
          body.materialId ?? null,
          body.description,
          body.quantity,
          body.unit,
          body.unitPrice,
          body.sortOrder,
        ],
      );
      return reply.status(201).send({ data: rows[0] });
    },
  );

  // PUT /api/estimate-items/materials/:id — обновить материал
  fastify.put<{ Params: { id: string } }>(
    '/materials/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = updateEstimateMaterialSchema.parse(request.body);
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (body.materialId !== undefined) { sets.push(`material_id = $${i++}`); values.push(body.materialId); }
      if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); }
      if (body.quantity !== undefined) { sets.push(`quantity = $${i++}`); values.push(body.quantity); }
      if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); }
      if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); }
      if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }

      if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

      values.push(request.params.id);
      const { rows } = await fastify.pool.query(
        `UPDATE estimate_materials SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        values,
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
      return { data: rows[0] };
    },
  );

  // DELETE /api/estimate-items/materials/:id — удалить материал
  fastify.delete<{ Params: { id: string } }>(
    '/materials/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rowCount } = await fastify.pool.query(
        'DELETE FROM estimate_materials WHERE id = $1',
        [request.params.id],
      );
      if (rowCount === 0) return reply.status(404).send({ error: 'Материал не найден' });
      return { success: true };
    },
  );
}
