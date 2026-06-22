import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit, recordAuditBatch, type AuditInput } from '../../lib/audit.js';
import { makeEstimateEvent } from '../../lib/realtime/bus.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { mirrorMaterialsToCatalog } from '../../lib/catalog.js';
import {
  createEstimateSchema,
  updateEstimateSchema,
  createEstimateItemSchema,
  updateEstimateItemSchema,
  setEstimateContractorSchema,
  bulkDeleteEstimateItemsSchema,
  bulkConfirmEstimateItemsSchema,
  type EstimateChangeReason,
} from '@estimat/shared';

export default async function estimateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // projectId сметы (для payload события и денормализации в журнал).
  async function loadProjectId(db: Pick<PoolClient, 'query'>, estimateId: string): Promise<string | null> {
    const { rows } = await db.query('SELECT project_id FROM estimates WHERE id = $1', [estimateId]);
    return rows[0]?.project_id ?? null;
  }

  // Эмит realtime-события после COMMIT (fire-and-forget внутри плагина).
  async function emit(
    reason: EstimateChangeReason,
    estimateId: string,
    projectId: string | null,
    actorUserId: string,
    extra?: { auditLogId?: string | null; correlationId?: string | null },
  ): Promise<void> {
    await fastify.publishEstimateChanged(
      makeEstimateEvent({ estimateId, projectId, reason, actorUserId, ...extra }),
    );
  }

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

  // GET /api/estimates/:id — работы (с измерениями + автором), материалы (вложенно), подрядчики
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
              cc.name AS cost_category_name,
              uc.full_name AS created_by_name,
              uu.full_name AS updated_by_name
       FROM estimate_items ei
       LEFT JOIN rates r            ON ei.rate_id = r.id
       LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
       LEFT JOIN users uc           ON ei.created_by = uc.id
       LEFT JOIN users uu           ON ei.updated_by = uu.id
       WHERE ei.estimate_id = $1
       ORDER BY cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`,
      [request.params.id],
    );

    const materials = await fastify.pool.query(
      `SELECT em.*, mc.name AS material_name,
              uc.full_name AS created_by_name,
              uu.full_name AS updated_by_name
       FROM estimate_materials em
       LEFT JOIN material_catalog mc ON em.material_id = mc.id
       LEFT JOIN users uc            ON em.created_by = uc.id
       LEFT JOIN users uu            ON em.updated_by = uu.id
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

  // GET /api/estimates/:id/history — лента изменений сметы (или истории конкретной строки
  // при ?entityId=). Доступ проверяется единым assertEstimateAccess (как WS-подписка).
  fastify.get<{ Params: { id: string }; Querystring: { entityId?: string; limit?: string; offset?: string } }>(
    '/:id/history',
    async (request, reply) => {
      try {
        await assertEstimateAccess(fastify.pool, request.params.id, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const limit = Math.min(Number(request.query.limit) || 100, 500);
      const offset = Math.max(Number(request.query.offset) || 0, 0);
      const values: unknown[] = [request.params.id];
      let where = 'al.estimate_id = $1';
      if (request.query.entityId) {
        values.push(request.query.entityId);
        where += ` AND al.entity_id = $${values.length}`;
      }
      values.push(limit);
      const limIdx = values.length;
      values.push(offset);
      const offIdx = values.length;
      const { rows } = await fastify.pool.query(
        `SELECT al.id, al.estimate_id, al.project_id, al.entity_type, al.entity_id, al.action,
                al.user_id, al.correlation_id, al.changes, al.created_at,
                u.full_name AS user_name
         FROM audit_log al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE ${where}
         ORDER BY al.created_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        values,
      );
      return { data: rows.map(mapAuditRow) };
    },
  );

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
    const estimate = rows[0];
    await recordAudit(fastify.pool, {
      estimateId: estimate.id,
      projectId: estimate.project_id,
      entityType: 'estimate',
      entityId: estimate.id,
      action: 'create',
      userId: request.currentUser.id,
      changes: { after: estimate },
    });
    return reply.status(201).send({ data: estimate });
  });

  // PUT /api/estimates/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateEstimateSchema.parse(request.body);
    const fields: string[] = [];
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.costCategoryId !== undefined) { sets.push(`cost_category_id = $${i++}`); values.push(body.costCategoryId); fields.push('cost_category_id'); }
    if (body.workType !== undefined) { sets.push(`work_type = $${i++}`); values.push(body.workType); fields.push('work_type'); }
    if (body.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(body.notes); fields.push('notes'); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: oldRows } = await client.query('SELECT * FROM estimates WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (oldRows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Смета не найдена' });
      }
      values.push(request.params.id);
      const { rows } = await client.query(`UPDATE estimates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
      const auditId = await recordAudit(client, {
        estimateId: request.params.id,
        projectId: rows[0].project_id,
        entityType: 'estimate',
        entityId: request.params.id,
        action: 'update',
        userId: request.currentUser.id,
        changes: diffChanges(oldRows[0], rows[0], fields),
      });
      await client.query('COMMIT');
      await emit('estimate_updated', request.params.id, rows[0].project_id, request.currentUser.id, { auditLogId: auditId });
      return { data: rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // DELETE /api/estimates/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('admin', 'manager')] },
    async (request, reply) => {
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM estimates WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Смета не найдена' });
        }
        await client.query('DELETE FROM estimates WHERE id = $1', [request.params.id]);
        // estimate_id в журнале станет NULL (ON DELETE SET NULL) — project_id и snapshot переживут удаление.
        await recordAudit(client, {
          estimateId: request.params.id,
          projectId: rows[0].project_id,
          entityType: 'estimate',
          entityId: request.params.id,
          action: 'delete',
          userId: request.currentUser.id,
          changes: { before: rows[0] },
        });
        await client.query('COMMIT');
        return { success: true };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
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
        `INSERT INTO estimate_contractors (estimate_id, cost_type_id, contractor_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (estimate_id, cost_type_id)
           DO UPDATE SET contractor_id = EXCLUDED.contractor_id, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [request.params.id, body.costTypeId, body.contractorId, request.currentUser.id],
      );
      const projectId = await loadProjectId(fastify.pool, request.params.id);
      const auditId = await recordAudit(fastify.pool, {
        estimateId: request.params.id,
        projectId,
        entityType: 'estimate_contractor',
        entityId: rows[0].id,
        action: 'update',
        userId: request.currentUser.id,
        changes: { after: rows[0] },
      });
      await emit('contractor_set', request.params.id, projectId, request.currentUser.id, { auditLogId: auditId });
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
      const { rows } = await fastify.pool.query(
        'DELETE FROM estimate_contractors WHERE estimate_id = $1 AND cost_type_id = $2 RETURNING *',
        [request.params.id, costTypeId],
      );
      if (rows.length === 0) return { success: true };
      const projectId = await loadProjectId(fastify.pool, request.params.id);
      const auditId = await recordAudit(fastify.pool, {
        estimateId: request.params.id,
        projectId,
        entityType: 'estimate_contractor',
        entityId: rows[0].id,
        action: 'delete',
        userId: request.currentUser.id,
        changes: { before: rows[0] },
      });
      await emit('contractor_cleared', request.params.id, projectId, request.currentUser.id, { auditLogId: auditId });
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
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO estimate_items
             (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
          [
            request.params.id,
            body.costTypeId ?? null,
            body.rateId ?? null,
            body.description,
            body.quantity,
            body.unit,
            body.unitPrice,
            body.sortOrder,
            request.currentUser.id,
          ],
        );
        const item = rows[0];

        // Типовые материалы расценки — статус 'suggested', количество = объём × коэффициент расхода.
        let materials: Record<string, unknown>[] = [];
        if (body.rateId) {
          const inserted = await client.query(
            `INSERT INTO estimate_materials
               (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status, created_by, updated_by)
             SELECT $1, $2, mc.id, mc.name,
                    ROUND($3::numeric * rm.qty_ratio, 4), mc.unit,
                    COALESCE(mc.unit_price, 0), rm.sort_order, 'suggested', $5, $5
             FROM rate_materials rm
             JOIN material_catalog mc ON mc.id = rm.material_id
             WHERE rm.rate_id = $4 AND mc.is_active
             ORDER BY rm.sort_order
             RETURNING *`,
            [item.id, request.params.id, body.quantity, body.rateId, request.currentUser.id],
          );
          materials = inserted.rows;
        }

        const auditId = await recordAudit(client, {
          estimateId: request.params.id,
          projectId: item.project_id,
          entityType: 'estimate_item',
          entityId: item.id,
          action: 'create',
          userId: request.currentUser.id,
          changes: { after: item },
        });
        if (materials.length) {
          await recordAuditBatch(
            client,
            materials.map((m) => ({
              estimateId: request.params.id,
              projectId: item.project_id,
              entityType: 'estimate_material',
              entityId: m.id as string,
              action: 'create',
              userId: request.currentUser.id,
              changes: { after: m, source: 'suggested' },
            })),
          );
        }
        await client.query('COMMIT');
        await emit('item_created', request.params.id, item.project_id, request.currentUser.id, { auditLogId: auditId });
        return reply.status(201).send({ data: { ...item, materials } });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // PUT /api/estimates/items/:id — обновить работу
  fastify.put<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateEstimateItemSchema.parse(request.body);
    const fields: string[] = [];
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.costTypeId !== undefined) { sets.push(`cost_type_id = $${i++}`); values.push(body.costTypeId); fields.push('cost_type_id'); }
    if (body.rateId !== undefined) { sets.push(`rate_id = $${i++}`); values.push(body.rateId); fields.push('rate_id'); }
    if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); fields.push('description'); }
    if (body.quantity !== undefined) { sets.push(`quantity = $${i++}`); values.push(body.quantity); fields.push('quantity'); }
    if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); fields.push('unit'); }
    if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); fields.push('unit_price'); }
    if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); fields.push('sort_order'); }
    // Снятие «не согласовано» (согласование ИИ-позиции) — отдельным флагом needsReview.
    if (body.needsReview !== undefined) { sets.push(`needs_review = $${i++}`); values.push(body.needsReview); fields.push('needs_review'); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });
    sets.push(`updated_by = $${i++}`); values.push(request.currentUser.id);

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: oldRows } = await client.query('SELECT * FROM estimate_items WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (oldRows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Позиция не найдена' });
      }
      values.push(request.params.id);
      const { rows } = await client.query(`UPDATE estimate_items SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
      // Согласование (снятие только needs_review) логируем как 'confirm', прочие правки — 'update'.
      const isConfirm = fields.length === 1 && fields[0] === 'needs_review';
      const auditId = await recordAudit(client, {
        estimateId: rows[0].estimate_id,
        projectId: rows[0].project_id,
        entityType: 'estimate_item',
        entityId: rows[0].id,
        action: isConfirm ? 'confirm' : 'update',
        userId: request.currentUser.id,
        changes: diffChanges(oldRows[0], rows[0], fields),
      });
      await client.query('COMMIT');
      await emit('item_updated', rows[0].estimate_id, rows[0].project_id, request.currentUser.id, { auditLogId: auditId });
      return { data: rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/estimates/:id/confirm-all — согласовать все ИИ-позиции (снять needs_review),
  // row-level аудит по каждой затронутой работе/материалу.
  fastify.post<{ Params: { id: string } }>('/:id/confirm-all', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const works = await client.query(
        'UPDATE estimate_items SET needs_review = false, updated_by = $2 WHERE estimate_id = $1 AND needs_review = true RETURNING id, estimate_id, project_id',
        [request.params.id, request.currentUser.id],
      );
      const materials = await client.query(
        'UPDATE estimate_materials SET needs_review = false, updated_by = $2 WHERE estimate_id = $1 AND needs_review = true RETURNING id, estimate_id',
        [request.params.id, request.currentUser.id],
      );
      const projectId = works.rows[0]?.project_id ?? (await loadProjectId(client, request.params.id));
      const audits: AuditInput[] = [
        ...works.rows.map((r) => ({
          estimateId: request.params.id,
          projectId,
          entityType: 'estimate_item',
          entityId: r.id as string,
          action: 'confirm',
          userId: request.currentUser.id,
          changes: { changedFields: ['needs_review'], after: { needs_review: false } },
        })),
        ...materials.rows.map((r) => ({
          estimateId: request.params.id,
          projectId,
          entityType: 'estimate_material',
          entityId: r.id as string,
          action: 'confirm',
          userId: request.currentUser.id,
          changes: { changedFields: ['needs_review'], after: { needs_review: false } },
        })),
      ];
      await recordAuditBatch(client, audits);
      await client.query('COMMIT');
      if (audits.length) await emit('confirmed_all', request.params.id, projectId, request.currentUser.id);
      return reply.send({ works: works.rowCount ?? 0, materials: materials.rowCount ?? 0 });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/estimates/:id/bulk-confirm — выборочное согласование работ и материалов (снять needs_review).
  // Материалы согласуются каскадом для выбранных работ + явно выбранные; согласованные материалы
  // зеркалируются в legacy-справочник material_catalog (структура Категория → Вид работ).
  fastify.post<{ Params: { id: string } }>(
    '/:id/bulk-confirm',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      if (!estimateId.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const { workIds, materialIds } = bulkConfirmEstimateItemsSchema.parse(request.body);
      const eid = estimateId.data;

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const works = await client.query(
          `UPDATE estimate_items SET needs_review = false, updated_by = $3
            WHERE estimate_id = $1 AND id = ANY($2::uuid[]) AND needs_review = true
            RETURNING id`,
          [eid, workIds, request.currentUser.id],
        );
        const materials = await client.query(
          `UPDATE estimate_materials SET needs_review = false, status = 'confirmed', updated_by = $4
            WHERE estimate_id = $1 AND needs_review = true
              AND (item_id = ANY($2::uuid[]) OR id = ANY($3::uuid[]))
            RETURNING id`,
          [eid, workIds, materialIds, request.currentUser.id],
        );

        // Пополнение legacy-справочника материалов согласованными позициями.
        await mirrorMaterialsToCatalog(
          client,
          materials.rows.map((r) => r.id as string),
          request.currentUser.id,
        );

        const projectId = await loadProjectId(client, eid);
        const audits: AuditInput[] = [
          ...works.rows.map((r) => ({
            estimateId: eid, projectId, entityType: 'estimate_item', entityId: r.id as string,
            action: 'confirm', userId: request.currentUser.id,
            changes: { changedFields: ['needs_review'], after: { needs_review: false } },
          })),
          ...materials.rows.map((r) => ({
            estimateId: eid, projectId, entityType: 'estimate_material', entityId: r.id as string,
            action: 'confirm', userId: request.currentUser.id,
            changes: { changedFields: ['needs_review'], after: { needs_review: false } },
          })),
        ];
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        if (audits.length) await emit('confirmed_all', eid, projectId, request.currentUser.id);
        return reply.send({ works: works.rowCount ?? 0, materials: materials.rowCount ?? 0 });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // DELETE /api/estimates/items/:id — удалить работу (материалы каскадом; snapshot обоих в журнал)
  fastify.delete<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: work } = await client.query('SELECT * FROM estimate_items WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (work.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Позиция не найдена' });
      }
      const { rows: mats } = await client.query('SELECT * FROM estimate_materials WHERE item_id = $1', [request.params.id]);
      await client.query('DELETE FROM estimate_items WHERE id = $1', [request.params.id]);
      const estimateId = work[0].estimate_id;
      const projectId = work[0].project_id;
      const audits: AuditInput[] = [
        {
          estimateId, projectId, entityType: 'estimate_item', entityId: work[0].id,
          action: 'delete', userId: request.currentUser.id, changes: { before: work[0] },
        },
        ...mats.map((m) => ({
          estimateId, projectId, entityType: 'estimate_material', entityId: m.id as string,
          action: 'delete', userId: request.currentUser.id, changes: { before: m, reason: 'cascade' },
        })),
      ];
      await recordAuditBatch(client, audits);
      await client.query('COMMIT');
      await emit('item_deleted', estimateId, projectId, request.currentUser.id);
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/estimates/:id/bulk-delete — массовое удаление работ (с каскадом материалов) и материалов.
  fastify.post<{ Params: { id: string } }>(
    '/:id/bulk-delete',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      if (!estimateId.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const { workIds, materialIds } = bulkDeleteEstimateItemsSchema.parse(request.body);
      const eid = estimateId.data;

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const projectId = await loadProjectId(client, eid);
        const audits: AuditInput[] = [];
        let deletedWorks = 0;
        let deletedMaterials = 0;

        if (workIds.length) {
          // Snapshot работ и их каскадных материалов до удаления.
          const { rows: works } = await client.query(
            'SELECT * FROM estimate_items WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
            [workIds, eid],
          );
          const { rows: cascade } = await client.query(
            'SELECT * FROM estimate_materials WHERE item_id = ANY($1::uuid[]) AND estimate_id = $2',
            [workIds, eid],
          );
          const r = await client.query(
            'DELETE FROM estimate_items WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
            [workIds, eid],
          );
          deletedWorks = r.rowCount ?? 0;
          for (const w of works) {
            audits.push({ estimateId: eid, projectId, entityType: 'estimate_item', entityId: w.id, action: 'delete', userId: request.currentUser.id, changes: { before: w } });
          }
          for (const m of cascade) {
            audits.push({ estimateId: eid, projectId, entityType: 'estimate_material', entityId: m.id, action: 'delete', userId: request.currentUser.id, changes: { before: m, reason: 'cascade' } });
          }
        }
        if (materialIds.length) {
          const { rows: mats } = await client.query(
            'SELECT * FROM estimate_materials WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
            [materialIds, eid],
          );
          const r = await client.query(
            'DELETE FROM estimate_materials WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
            [materialIds, eid],
          );
          deletedMaterials = r.rowCount ?? 0;
          for (const m of mats) {
            audits.push({ estimateId: eid, projectId, entityType: 'estimate_material', entityId: m.id, action: 'delete', userId: request.currentUser.id, changes: { before: m } });
          }
        }
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        await emit('bulk_deleted', eid, projectId, request.currentUser.id);
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

// Снимок изменённых полей для журнала: before/after по затронутым колонкам.
function diffChanges(oldRow: Record<string, unknown>, newRow: Record<string, unknown>, fields: string[]) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const f of fields) {
    before[f] = oldRow[f];
    after[f] = newRow[f];
  }
  return { before, after, changedFields: fields };
}

// Маппинг строки audit_log в read-модель истории (snake → camel).
function mapAuditRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    estimateId: r.estimate_id,
    projectId: r.project_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    userId: r.user_id,
    userName: r.user_name ?? null,
    correlationId: r.correlation_id ?? null,
    changes: r.changes ?? null,
    createdAt: r.created_at,
  };
}
