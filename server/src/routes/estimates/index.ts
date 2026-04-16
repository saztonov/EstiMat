import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createEstimateSchema,
  updateEstimateSchema,
  createEstimateItemSchema,
  updateEstimateItemSchema,
  createEstimateSectionSchema,
  updateEstimateSectionSchema,
} from '@estimat/shared';

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

  // GET /api/estimates/:id — с разделами и позициями
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

    const sections = await fastify.pool.query(
      `SELECT s.*,
              ct.name AS cost_type_name,
              cc.id   AS cost_category_id,
              cc.name AS cost_category_name
       FROM estimate_sections s
       LEFT JOIN cost_types ct      ON s.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ct.category_id = cc.id
       WHERE s.estimate_id = $1
       ORDER BY s.sort_order, s.created_at`,
      [request.params.id],
    );

    const items = await fastify.pool.query(
      `SELECT ei.*,
              r.name as rate_name, r.code as rate_code,
              mc.name as material_name
       FROM estimate_items ei
       LEFT JOIN rates r ON ei.rate_id = r.id
       LEFT JOIN material_catalog mc ON ei.material_id = mc.id
       WHERE ei.estimate_id = $1
       ORDER BY ei.sort_order, ei.created_at`,
      [request.params.id],
    );

    const sectionsWithItems = sections.rows.map((s) => ({
      ...s,
      items: items.rows.filter((i) => i.section_id === s.id),
    }));

    return {
      data: {
        ...rows[0],
        sections: sectionsWithItems,
        items: items.rows, // для обратной совместимости
      },
    };
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

    await fastify.pool.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes)
       VALUES ('estimate', $1, $2, $3, $4)`,
      [request.params.id, `status_changed_to_${status}`, request.currentUser.id, JSON.stringify({ status })],
    );

    return { data: rows[0] };
  });

  // === Разделы ===

  async function assertDraft(estimateId: string) {
    const { rows } = await fastify.pool.query(
      `SELECT status FROM estimates WHERE id = $1`,
      [estimateId],
    );
    if (rows.length === 0) return { ok: false, code: 404, err: 'Смета не найдена' };
    if (rows[0].status !== 'draft') return { ok: false, code: 409, err: 'Редактировать можно только черновик' };
    return { ok: true };
  }

  // POST /api/estimates/:id/sections
  fastify.post<{ Params: { id: string } }>(
    '/:id/sections',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const check = await assertDraft(request.params.id);
      if (!check.ok) return reply.status(check.code!).send({ error: check.err });

      const body = createEstimateSectionSchema.parse(request.body);

      const { rows: ctypeRows } = await fastify.pool.query(
        `SELECT ct.name AS type_name, cc.name AS category_name
         FROM cost_types ct
         JOIN cost_categories cc ON ct.category_id = cc.id
         WHERE ct.id = $1 AND ct.category_id = $2`,
        [body.costTypeId, body.costCategoryId],
      );
      if (ctypeRows.length === 0) {
        return reply.status(400).send({ error: 'Вид затрат не принадлежит выбранной категории' });
      }
      const name = `${ctypeRows[0].category_name} / ${ctypeRows[0].type_name}`;

      const { rows: created } = await fastify.pool.query(
        `INSERT INTO estimate_sections (estimate_id, cost_type_id, name, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [request.params.id, body.costTypeId, name, body.sortOrder ?? 0],
      );
      return reply.status(201).send({ data: created[0] });
    },
  );

  // PUT /api/estimates/sections/:id
  fastify.put<{ Params: { id: string } }>(
    '/sections/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = updateEstimateSectionSchema.parse(request.body);

      const { rows: existing } = await fastify.pool.query(
        `SELECT estimate_id FROM estimate_sections WHERE id = $1`,
        [request.params.id],
      );
      if (existing.length === 0) return reply.status(404).send({ error: 'Раздел не найден' });

      const check = await assertDraft(existing[0].estimate_id);
      if (!check.ok) return reply.status(check.code!).send({ error: check.err });

      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (body.costTypeId !== undefined && body.costCategoryId !== undefined) {
        const { rows: ctypeRows } = await fastify.pool.query(
          `SELECT ct.name AS type_name, cc.name AS category_name
           FROM cost_types ct
           JOIN cost_categories cc ON ct.category_id = cc.id
           WHERE ct.id = $1 AND ct.category_id = $2`,
          [body.costTypeId, body.costCategoryId],
        );
        if (ctypeRows.length === 0) {
          return reply.status(400).send({ error: 'Вид затрат не принадлежит выбранной категории' });
        }
        sets.push(`cost_type_id = $${i++}`); values.push(body.costTypeId);
        sets.push(`name = $${i++}`); values.push(`${ctypeRows[0].category_name} / ${ctypeRows[0].type_name}`);
      }
      if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }

      if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

      values.push(request.params.id);
      const { rows } = await fastify.pool.query(
        `UPDATE estimate_sections SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        values,
      );
      return { data: rows[0] };
    },
  );

  // DELETE /api/estimates/sections/:id
  fastify.delete<{ Params: { id: string } }>(
    '/sections/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rows: existing } = await fastify.pool.query(
        `SELECT estimate_id FROM estimate_sections WHERE id = $1`,
        [request.params.id],
      );
      if (existing.length === 0) return reply.status(404).send({ error: 'Раздел не найден' });

      const check = await assertDraft(existing[0].estimate_id);
      if (!check.ok) return reply.status(check.code!).send({ error: check.err });

      await fastify.pool.query('DELETE FROM estimate_sections WHERE id = $1', [request.params.id]);
      return { success: true };
    },
  );

  // POST /api/estimates/sections/:id/items — создать позицию в разделе
  fastify.post<{ Params: { id: string } }>(
    '/sections/:id/items',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rows: sec } = await fastify.pool.query(
        `SELECT estimate_id FROM estimate_sections WHERE id = $1`,
        [request.params.id],
      );
      if (sec.length === 0) return reply.status(404).send({ error: 'Раздел не найден' });

      const check = await assertDraft(sec[0].estimate_id);
      if (!check.ok) return reply.status(check.code!).send({ error: check.err });

      const body = createEstimateItemSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO estimate_items
           (estimate_id, section_id, item_type, rate_id, material_id, description, quantity, unit, unit_price, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          sec[0].estimate_id,
          request.params.id,
          body.itemType,
          body.rateId ?? null,
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

  // === Позиции (legacy + обновление) ===

  // POST /api/estimates/:id/items — legacy, без раздела
  fastify.post<{ Params: { id: string } }>('/:id/items', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const check = await assertDraft(request.params.id);
    if (!check.ok) return reply.status(check.code!).send({ error: check.err });

    const body = createEstimateItemSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO estimate_items
         (estimate_id, section_id, item_type, rate_id, material_id, description, quantity, unit, unit_price, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        request.params.id,
        body.sectionId ?? null,
        body.itemType,
        body.rateId ?? null,
        body.materialId ?? null,
        body.description,
        body.quantity,
        body.unit,
        body.unitPrice,
        body.sortOrder,
      ],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/estimates/items/:id
  fastify.put<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateEstimateItemSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.sectionId !== undefined) { sets.push(`section_id = $${i++}`); values.push(body.sectionId); }
    if (body.itemType !== undefined) { sets.push(`item_type = $${i++}`); values.push(body.itemType); }
    if (body.rateId !== undefined) { sets.push(`rate_id = $${i++}`); values.push(body.rateId); }
    if (body.materialId !== undefined) { sets.push(`material_id = $${i++}`); values.push(body.materialId); }
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
