import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createEstimateSchema,
  updateEstimateSchema,
  createEstimateItemSchema,
  updateEstimateItemSchema,
  setEstimateContractorSchema,
  bulkDeleteEstimateItemsSchema,
} from '@estimat/shared';

export default async function estimateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/estimates?projectId=
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    let query = `SELECT e.*,
                        p.code AS project_code,
                        p.name AS project_name,
                        cc.name AS cost_category_name
                 FROM estimates e
                 JOIN projects p ON e.project_id = p.id
                 LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id`;
    const values: string[] = [];
    if (projectId) {
      query += ' WHERE e.project_id = $1';
      values.push(projectId);
    }
    query += ' ORDER BY e.created_at DESC';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // GET /api/estimates/:id — работы (с измерениями), материалы (вложенно), подрядчики по видам затрат
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT e.*,
              p.code AS project_code,
              p.name AS project_name,
              cc.name AS cost_category_name
       FROM estimates e
       JOIN projects p ON e.project_id = p.id
       LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
       WHERE e.id = $1`,
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Смета не найдена' });

    const items = await fastify.pool.query(
      `SELECT ei.*,
              r.name  AS rate_name,
              r.code  AS rate_code,
              ct.name AS cost_type_name,
              cc.name AS cost_category_name
       FROM estimate_items ei
       LEFT JOIN rates r            ON ei.rate_id = r.id
       LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
       WHERE ei.estimate_id = $1
       ORDER BY cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`,
      [request.params.id],
    );

    const materials = await fastify.pool.query(
      `SELECT em.*, mc.name AS material_name
       FROM estimate_materials em
       LEFT JOIN material_catalog mc ON em.material_id = mc.id
       WHERE em.estimate_id = $1
       ORDER BY em.sort_order, em.created_at`,
      [request.params.id],
    );

    const contractors = await fastify.pool.query(
      `SELECT ec.cost_type_id, ec.contractor_id,
              o.name  AS contractor_name,
              ct.name AS cost_type_name,
              cc.id   AS cost_category_id,
              cc.name AS cost_category_name
       FROM estimate_contractors ec
       LEFT JOIN organizations o    ON ec.contractor_id = o.id
       LEFT JOIN cost_types ct      ON ec.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ct.category_id = cc.id
       WHERE ec.estimate_id = $1`,
      [request.params.id],
    );

    const itemsWithMaterials = items.rows.map((it) => ({
      ...it,
      materials: materials.rows.filter((m) => m.item_id === it.id),
    }));

    return {
      data: {
        ...rows[0],
        items: itemsWithMaterials,
        contractors: contractors.rows,
      },
    };
  });

  // POST /api/estimates
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = createEstimateSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO estimates (project_id, cost_category_id, work_type, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        body.projectId,
        body.costCategoryId || null,
        body.workType || null,
        body.notes || null,
        request.currentUser.id,
      ],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/estimates/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateEstimateSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.costCategoryId !== undefined) { sets.push(`cost_category_id = $${i++}`); values.push(body.costCategoryId); }
    if (body.workType !== undefined) { sets.push(`work_type = $${i++}`); values.push(body.workType); }
    if (body.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(body.notes); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE estimates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Смета не найдена' });
    return { data: rows[0] };
  });

  // DELETE /api/estimates/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { rowCount } = await fastify.pool.query(
        'DELETE FROM estimates WHERE id = $1',
        [request.params.id],
      );
      if (rowCount === 0) return reply.status(404).send({ error: 'Смета не найдена' });
      await fastify.pool.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes)
         VALUES ('estimate', $1, 'deleted', $2, '{}')`,
        [request.params.id, request.currentUser.id],
      );
      return { success: true };
    },
  );

  // === Подрядчик на вид затрат ===

  // PUT /api/estimates/:id/contractors — назначить/сменить подрядчика для вида затрат
  fastify.put<{ Params: { id: string } }>(
    '/:id/contractors',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = setEstimateContractorSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO estimate_contractors (estimate_id, cost_type_id, contractor_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (estimate_id, cost_type_id)
           DO UPDATE SET contractor_id = EXCLUDED.contractor_id, updated_at = now()
         RETURNING *`,
        [request.params.id, body.costTypeId, body.contractorId],
      );
      return { data: rows[0] };
    },
  );

  // DELETE /api/estimates/:id/contractors?costTypeId= — снять подрядчика с вида затрат
  fastify.delete<{ Params: { id: string }; Querystring: { costTypeId?: string } }>(
    '/:id/contractors',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { costTypeId } = request.query;
      if (!costTypeId) return reply.status(400).send({ error: 'Не указан вид затрат' });
      await fastify.pool.query(
        'DELETE FROM estimate_contractors WHERE estimate_id = $1 AND cost_type_id = $2',
        [request.params.id, costTypeId],
      );
      return { success: true };
    },
  );

  // === Работы (строки сметы) ===

  // POST /api/estimates/:id/items — создать работу
  fastify.post<{ Params: { id: string } }>(
    '/:id/items',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = createEstimateItemSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO estimate_items
           (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          request.params.id,
          body.costTypeId ?? null,
          body.rateId ?? null,
          body.description,
          body.quantity,
          body.unit,
          body.unitPrice,
          body.sortOrder,
        ],
      );
      const item = rows[0];

      // Типовые материалы расценки добавляются автоматически со статусом
      // 'suggested' («предложение»): количество = объём работы × коэффициент расхода.
      let materials: unknown[] = [];
      if (body.rateId) {
        const inserted = await fastify.pool.query(
          `INSERT INTO estimate_materials
             (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status)
           SELECT $1, $2, mc.id, mc.name,
                  ROUND($3::numeric * rm.qty_ratio, 4), mc.unit,
                  COALESCE(mc.unit_price, 0), rm.sort_order, 'suggested'
           FROM rate_materials rm
           JOIN material_catalog mc ON mc.id = rm.material_id
           WHERE rm.rate_id = $4 AND mc.is_active
           ORDER BY rm.sort_order
           RETURNING *`,
          [item.id, request.params.id, body.quantity, body.rateId],
        );
        materials = inserted.rows;
      }

      return reply.status(201).send({ data: { ...item, materials } });
    },
  );

  // PUT /api/estimates/items/:id — обновить работу
  fastify.put<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateEstimateItemSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.costTypeId !== undefined) { sets.push(`cost_type_id = $${i++}`); values.push(body.costTypeId); }
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

  // DELETE /api/estimates/items/:id — удалить работу (материалы удалятся каскадом)
  fastify.delete<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM estimate_items WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Позиция не найдена' });
    return { success: true };
  });

  // POST /api/estimates/:id/bulk-delete — массовое удаление работ (с каскадом материалов) и материалов.
  // Одна транзакция: сначала работы (их материалы уходят каскадом), затем оставшиеся материалы.
  fastify.post<{ Params: { id: string } }>(
    '/:id/bulk-delete',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      if (!estimateId.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const { workIds, materialIds } = bulkDeleteEstimateItemsSchema.parse(request.body);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        let deletedWorks = 0;
        let deletedMaterials = 0;
        if (workIds.length) {
          const r = await client.query(
            'DELETE FROM estimate_items WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
            [workIds, estimateId.data],
          );
          deletedWorks = r.rowCount ?? 0;
        }
        if (materialIds.length) {
          // Материалы выбранных работ уже удалены каскадом — сюда попадут только явно выбранные.
          const r = await client.query(
            'DELETE FROM estimate_materials WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
            [materialIds, estimateId.data],
          );
          deletedMaterials = r.rowCount ?? 0;
        }
        await client.query('COMMIT');
        return { success: true, deletedWorks, deletedMaterials };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
