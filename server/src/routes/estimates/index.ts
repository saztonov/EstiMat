import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit, recordAuditBatch, type AuditInput } from '../../lib/audit.js';
import { makeEstimateEvent } from '../../lib/realtime/bus.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { mirrorMaterialsToCatalog } from '../../lib/catalog.js';
import { legacyToLocations, deriveLegacyLocation } from '../../lib/location.js';
import { exportEstimateKp, ExportError } from '../../lib/estimate-export/index.js';
import {
  createEstimateSchema,
  updateEstimateSchema,
  createEstimateItemSchema,
  updateEstimateItemSchema,
  setEstimateContractorSchema,
  bulkDeleteEstimateItemsSchema,
  bulkConfirmEstimateItemsSchema,
  bulkAssignEstimateItemsLocationSchema,
  reorderEstimateItemsSchema,
  setEstimateItemsVolumeTypeSchema,
  replicateItemsSchema,
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
  // Закрыто для contractor: подрядчик получает свои строки только через /api/contractors/*.
  fastify.get('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request) => {
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
  // Закрыто для contractor: отдаёт ВСЕ строки сметы; подрядчик использует /api/contractors/my-items.
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
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
              ct.sort_order AS cost_type_sort_order,
              cc.name AS cost_category_name,
              cc.sort_order AS cost_category_sort_order,
              z.name  AS zone_name,
              z.kind  AS zone_kind,
              rt.name AS room_type_name,
              lt.name AS location_type_name,
              uc.full_name AS created_by_name,
              uu.full_name AS updated_by_name
       FROM estimate_items ei
       LEFT JOIN rates r            ON ei.rate_id = r.id
       LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
       LEFT JOIN project_zones z    ON ei.zone_id = z.id
       LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
       LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
       LEFT JOIN users uc           ON ei.created_by = uc.id
       LEFT JOIN users uu           ON ei.updated_by = uu.id
       WHERE ei.estimate_id = $1
       ORDER BY z.sort_order NULLS LAST, ei.floor_from NULLS LAST, rt.sort_order NULLS LAST,
                cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`,
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

    // Построчные назначения подрядчиков (раздел «Подрядчики»): подрядчики строки,
    // распределённый объём, остаток без подрядчика и признак over-assigned.
    const itemContractors = await fastify.pool.query(
      `SELECT eic.item_id, eic.contractor_id, eic.assigned_qty, eic.assigned_percent,
              COALESCE(eic.assigned_qty, ei.quantity * eic.assigned_percent / 100.0, ei.quantity) AS effective_qty,
              o.name AS contractor_name
         FROM estimate_item_contractors eic
         JOIN estimate_items ei      ON ei.id = eic.item_id
         LEFT JOIN organizations o   ON o.id = eic.contractor_id
        WHERE eic.estimate_id = $1
        ORDER BY eic.assigned_at`,
      [request.params.id],
    );

    const itemsWithMaterials = items.rows.map((it) => {
      const its = itemContractors.rows.filter((c) => c.item_id === it.id);
      const assignedTotal = its.reduce((s, c) => s + Number(c.effective_qty), 0);
      const qty = Number(it.quantity);
      return {
        ...it,
        materials: materials.rows.filter((m) => m.item_id === it.id),
        item_contractors: its,
        assigned_total: assignedTotal,
        remaining_qty: Math.max(qty - assignedTotal, 0),
        over_assigned: assignedTotal > qty + 1e-6,
      };
    });

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
      const mapped = rows.map(mapAuditRow);
      // Резолвим UUID в имена и форматируем locations — клиенту отдаём готовые строки.
      await attachChangesView(fastify.pool, mapped);
      return { data: mapped };
    },
  );

  // POST /api/estimates/:id/export-kp — экспорт видимых (отфильтрованных на клиенте)
  // работ в Excel-шаблон «КП». Клиент присылает набор строк [{ id, locationLabel }] в
  // порядке отображения; сервер валидирует принадлежность смете и стримит .xlsx.
  const exportKpSchema = z.object({
    items: z
      .array(z.object({ id: z.string().uuid(), locationLabel: z.string() }))
      .min(1),
  });
  fastify.post<{ Params: { id: string } }>(
    '/:id/export-kp',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      try {
        await assertEstimateAccess(fastify.pool, request.params.id, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const parsed = exportKpSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Некорректный запрос экспорта' });

      try {
        const buffer = await exportEstimateKp(fastify.pool, request.params.id, parsed.data.items);
        const { rows } = await fastify.pool.query(
          `SELECT p.code AS project_code FROM estimates e
             JOIN projects p ON e.project_id = p.id WHERE e.id = $1`,
          [request.params.id],
        );
        const code = (rows[0]?.project_code as string | undefined)?.replace(/[^\w.-]+/g, '_');
        const nameRu = `КП${code ? '_' + code : ''}.xlsx`;
        reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header(
          'Content-Disposition',
          `attachment; filename="KP.xlsx"; filename*=UTF-8''${encodeURIComponent(nameRu)}`,
        );
        reply.header('X-Content-Type-Options', 'nosniff');
        return reply.send(buffer);
      } catch (err) {
        if (err instanceof ExportError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
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
      // Источник истины — locations; если не передан (старый клиент) — собираем из legacy-полей.
      const locations = body.locations ?? legacyToLocations(body.zoneId ?? null, body.floorFrom ?? null, body.floorTo ?? null);
      const primary = deriveLegacyLocation(locations);
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // Произвольный «тип» строки: upsert в project_location_types (уникально на объект).
        const projectId = await loadProjectId(client, request.params.id);
        const locationTypeId = await upsertLocationType(client, projectId, body.locationTypeName ?? null);
        // «Наверх вида затрат»: блокируем смету (сериализация одновременных добавлений) и берём
        // sort_order строго ниже всех строк этого вида — так строка станет первой в своей
        // локационной группе при текущем ORDER BY (локация → ei.sort_order → created_at).
        let sortOrder = body.sortOrder;
        if (body.placeOnTop) {
          await client.query('SELECT id FROM estimates WHERE id = $1 FOR UPDATE', [request.params.id]);
          const { rows: minRows } = await client.query(
            `SELECT COALESCE(MIN(sort_order), 0) - 1 AS so
               FROM estimate_items
              WHERE estimate_id = $1 AND cost_type_id IS NOT DISTINCT FROM $2`,
            [request.params.id, body.costTypeId ?? null],
          );
          sortOrder = Number(minRows[0].so);
        }
        const { rows } = await client.query(
          `INSERT INTO estimate_items
             (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order,
              zone_id, floor_from, floor_to, room_type_id, location_type_id, locations, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $15) RETURNING *`,
          [
            request.params.id,
            body.costTypeId ?? null,
            body.rateId ?? null,
            body.description,
            body.quantity,
            body.unit,
            body.unitPrice,
            sortOrder,
            primary.zoneId,
            primary.floorFrom,
            primary.floorTo,
            body.roomTypeId ?? null,
            locationTypeId,
            JSON.stringify(locations),
            request.currentUser.id,
          ],
        );
        const item = rows[0];

        // Типовые материалы расценки — статус 'suggested', количество = объём × коэффициент расхода.
        let materials: Record<string, unknown>[] = [];
        if (body.rateId) {
          const inserted = await client.query(
            `INSERT INTO estimate_materials
               (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status, qty_ratio, created_by, updated_by)
             SELECT $1, $2, mc.id, mc.name,
                    ROUND($3::numeric * rm.qty_ratio, 4), mc.unit,
                    COALESCE(mc.unit_price, 0), rm.sort_order, 'suggested', rm.qty_ratio, $5, $5
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
    // Локация строки. locations — источник истины (мультизона); из него выводим зеркало.
    if (body.locations !== undefined) {
      const primary = deriveLegacyLocation(body.locations);
      sets.push(`locations = $${i++}::jsonb`); values.push(JSON.stringify(body.locations)); fields.push('locations');
      sets.push(`zone_id = $${i++}`); values.push(primary.zoneId); fields.push('zone_id');
      sets.push(`floor_from = $${i++}`); values.push(primary.floorFrom); fields.push('floor_from');
      sets.push(`floor_to = $${i++}`); values.push(primary.floorTo); fields.push('floor_to');
    } else {
      // Обратная совместимость: точечная правка legacy-полей без locations (новый клиент шлёт locations).
      if (body.zoneId !== undefined) { sets.push(`zone_id = $${i++}`); values.push(body.zoneId); fields.push('zone_id'); }
      if (body.floorFrom !== undefined) { sets.push(`floor_from = $${i++}`); values.push(body.floorFrom); fields.push('floor_from'); }
      if (body.floorTo !== undefined) { sets.push(`floor_to = $${i++}`); values.push(body.floorTo); fields.push('floor_to'); }
    }
    if (body.roomTypeId !== undefined) { sets.push(`room_type_id = $${i++}`); values.push(body.roomTypeId); fields.push('room_type_id'); }
    // Снятие «не согласовано» (согласование ИИ-позиции) — отдельным флагом needsReview.
    if (body.needsReview !== undefined) { sets.push(`needs_review = $${i++}`); values.push(body.needsReview); fields.push('needs_review'); }

    if (sets.length === 0 && body.locationTypeName === undefined) return reply.status(400).send({ error: 'Нет данных для обновления' });
    sets.push(`updated_by = $${i++}`); values.push(request.currentUser.id);

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: oldRows } = await client.query('SELECT * FROM estimate_items WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (oldRows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Позиция не найдена' });
      }
      // OCC: строку успел изменить другой пользователь — не затираем его правки.
      // Возвращаем актуальную строку (с новым version), чтобы клиент обновил снимок.
      if (body.expectedVersion !== undefined && oldRows[0].version !== body.expectedVersion) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: 'Строку изменил другой пользователь. Проверьте актуальные данные и сохраните заново.',
          code: 'CONFLICT',
          data: oldRows[0],
        });
      }
      // Произвольный «тип» строки: upsert в project_location_types (нужен project_id строки).
      if (body.locationTypeName !== undefined) {
        const locationTypeId = await upsertLocationType(client, oldRows[0].project_id, body.locationTypeName);
        sets.push(`location_type_id = $${i++}`); values.push(locationTypeId); fields.push('location_type_id');
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

      // Авто-синхронизация количества материалов: при изменении объёма работы пересчитываем
      // кол-во материалов с заданным коэф-том (quantity = коэф × объём). Материалы без коэф-та
      // (ручное количество) не трогаем. total/version/итог сметы следуют через триггеры.
      if (body.quantity !== undefined && Number(oldRows[0].quantity) !== Number(rows[0].quantity)) {
        const { rows: recalced } = await client.query(
          `WITH before AS (
             SELECT id, quantity FROM estimate_materials
              WHERE item_id = $1 AND qty_ratio IS NOT NULL FOR UPDATE
           )
           UPDATE estimate_materials em
              SET quantity = ROUND(em.qty_ratio * $2::numeric, 4), updated_by = $3
             FROM before
            WHERE em.id = before.id
           RETURNING em.id, em.quantity, before.quantity AS old_quantity`,
          [rows[0].id, rows[0].quantity, request.currentUser.id],
        );
        if (recalced.length) {
          await recordAuditBatch(
            client,
            recalced.map((m) => ({
              estimateId: rows[0].estimate_id,
              projectId: rows[0].project_id,
              entityType: 'estimate_material' as const,
              entityId: m.id as string,
              action: 'update' as const,
              userId: request.currentUser.id,
              changes: {
                before: { quantity: m.old_quantity },
                after: { quantity: m.quantity },
                changedFields: ['quantity'],
                reason: 'work_quantity_changed',
              },
            })),
          );
        }
      }
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

  // PATCH /api/estimates/:id/items/reorder — нормализующая перестановка работ внутри вида
  // (клиент шлёт полный упорядоченный список id → sort_order = 0,1,2,…).
  fastify.patch<{ Params: { id: string } }>('/:id/items/reorder', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = reorderEstimateItemsSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `UPDATE estimate_items ei SET sort_order = t.ord - 1, updated_by = $3
         FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord)
         WHERE ei.id = t.id AND ei.estimate_id = $1`,
        [request.params.id, body.ids, request.currentUser.id],
      );
      const projectId = await loadProjectId(client, request.params.id);
      await client.query('COMMIT');
      if (rowCount) await emit('item_updated', request.params.id, projectId, request.currentUser.id);
      return reply.send({ success: true, updated: rowCount ?? 0 });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // PATCH /api/estimates/:id/items/volume-type — батч-переключение типа объёма (осн/доп).
  // Ленивая запись очереди тумблеров: last-write-wins, БЕЗ OCC (expectedVersion не нужен).
  // SET LOCAL estimat.skip_version_bump='on' → этот UPDATE не поднимает version, чтобы чужая
  // открытая форма правки другого поля той же строки не словила ложный 409 при сохранении.
  fastify.patch<{ Params: { id: string } }>(
    '/:id/items/volume-type',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      if (!estimateId.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const body = setEstimateItemsVolumeTypeSchema.parse(request.body);
      const eid = estimateId.data;

      // Дедуп по id — последнее значение в батче побеждает.
      const desired = new Map<string, 'main' | 'additional'>();
      for (const it of body.items) desired.set(it.id, it.volumeType);
      const ids = [...desired.keys()];
      const vts = [...desired.values()];

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL estimat.skip_version_bump = 'on'");
        // Снимок старых значений + UPDATE только реально изменившихся (before/after для журнала).
        const { rows } = await client.query(
          `WITH input AS (
             SELECT id, volume_type FROM unnest($2::uuid[], $3::text[]) AS t(id, volume_type)
           ),
           snapshot AS (
             SELECT ei.id, ei.volume_type AS old_vt
             FROM estimate_items ei JOIN input i ON i.id = ei.id
             WHERE ei.estimate_id = $1
           )
           UPDATE estimate_items ei
              SET volume_type = i.volume_type, updated_by = $4
             FROM input i JOIN snapshot s ON s.id = i.id
            WHERE ei.id = i.id AND ei.estimate_id = $1
              AND ei.volume_type IS DISTINCT FROM i.volume_type
           RETURNING ei.id, s.old_vt AS before_volume_type, ei.volume_type AS after_volume_type`,
          [eid, ids, vts, request.currentUser.id],
        );
        const projectId = await loadProjectId(client, eid);
        const audits: AuditInput[] = rows.map((r) => ({
          estimateId: eid,
          projectId,
          entityType: 'estimate_item',
          entityId: r.id as string,
          action: 'update',
          userId: request.currentUser.id,
          changes: {
            changedFields: ['volume_type'],
            before: { volume_type: r.before_volume_type },
            after: { volume_type: r.after_volume_type },
          },
        }));
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        if (rows.length) await emit('item_updated', eid, projectId, request.currentUser.id);
        return reply.send({
          data: rows.map((r) => ({ id: r.id as string, volume_type: r.after_volume_type as string })),
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

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

  // POST /api/estimates/:id/bulk-assign-location — массово назначить одно местоположение выбранным работам.
  // Перезаписывает locations (источник истины) + зеркало zone_id/floor_from/floor_to. Аудит — с before/after
  // по каждой строке (diffChanges), чтобы история показывала старое и новое местоположение.
  fastify.post<{ Params: { id: string } }>(
    '/:id/bulk-assign-location',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const eid = z.string().uuid().safeParse(request.params.id);
      if (!eid.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const { workIds, locations } = bulkAssignEstimateItemsLocationSchema.parse(request.body);
      const primary = deriveLegacyLocation(locations);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: oldRows } = await client.query(
          'SELECT * FROM estimate_items WHERE estimate_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE',
          [eid.data, workIds],
        );
        const oldById = new Map(oldRows.map((r) => [r.id as string, r]));
        const { rows } = await client.query(
          `UPDATE estimate_items
              SET locations = $1::jsonb, zone_id = $2, floor_from = $3, floor_to = $4, updated_by = $5
            WHERE estimate_id = $6 AND id = ANY($7::uuid[])
            RETURNING *`,
          [JSON.stringify(locations), primary.zoneId, primary.floorFrom, primary.floorTo,
           request.currentUser.id, eid.data, workIds],
        );
        const projectId = await loadProjectId(client, eid.data);
        const audits: AuditInput[] = rows.map((r) => ({
          estimateId: eid.data,
          projectId,
          entityType: 'estimate_item',
          entityId: r.id as string,
          action: 'update',
          userId: request.currentUser.id,
          changes: diffChanges(oldById.get(r.id as string)!, r, ['locations', 'zone_id', 'floor_from', 'floor_to']),
        }));
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        if (rows.length) await emit('item_updated', eid.data, projectId, request.currentUser.id);
        return reply.send({ updated: rows.length });
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

  // POST /api/estimates/:id/replicate-items — тиражирование набора работ на целевые локации.
  // Целевые контуры = декартово произведение zoneIds × roomTypeIds (пустая ось = значение
  // источника), диапазон этажей — override из body либо из источника. Каждый (источник × контур)
  // создаёт отдельную строку-копию (с материалами). Дубли по локации отсекаются (skipExisting).
  fastify.post<{ Params: { id: string } }>(
    '/:id/replicate-items',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      if (!estimateId.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const body = replicateItemsSchema.parse(request.body);
      const eid = estimateId.data;

      const zoneTargets: (string | undefined)[] = body.zoneIds.length ? body.zoneIds : [undefined];
      const roomTargets: (string | undefined)[] = body.roomTypeIds.length ? body.roomTypeIds : [undefined];
      const hasFloorOverride = body.floorFrom !== undefined || body.floorTo !== undefined;

      // Guard: ограничение на общий объём операции.
      if (body.sourceItemIds.length * zoneTargets.length * roomTargets.length > 5000) {
        return reply.status(400).send({ error: 'Слишком большой объём тиражирования (макс. 5000 строк)' });
      }

      const copyBatchId = randomUUID();
      const dupKey = (r: {
        cost_type_id: unknown; rate_id: unknown; description: unknown;
        zone_id: unknown; floor_from: unknown; floor_to: unknown; room_type_id: unknown;
        volume_type: unknown;
      }) =>
        [r.cost_type_id, r.rate_id ?? r.description, r.zone_id, r.floor_from, r.floor_to, r.room_type_id, r.volume_type].join('|');

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: sources } = await client.query(
          'SELECT * FROM estimate_items WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
          [body.sourceItemIds, eid],
        );
        if (sources.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Исходные строки не найдены' });
        }

        // Существующие ключи сметы — для skipExisting (включая уже созданные в этом батче).
        const existing = new Set<string>();
        if (body.skipExisting) {
          const { rows: all } = await client.query(
            'SELECT cost_type_id, rate_id, description, zone_id, floor_from, floor_to, room_type_id, volume_type FROM estimate_items WHERE estimate_id = $1',
            [eid],
          );
          for (const r of all) existing.add(dupKey(r));
        }

        const projectId = await loadProjectId(client, eid);
        const audits: AuditInput[] = [];
        let createdWorks = 0;
        let createdMaterials = 0;
        let skipped = 0;

        for (const src of sources) {
          for (const zone of zoneTargets) {
            for (const room of roomTargets) {
              const targetZone = zone === undefined ? src.zone_id : zone;
              const targetRoom = room === undefined ? src.room_type_id : room;
              const targetFloorFrom = hasFloorOverride ? (body.floorFrom ?? null) : src.floor_from;
              const targetFloorTo = hasFloorOverride ? (body.floorTo ?? null) : src.floor_to;

              const key = dupKey({
                cost_type_id: src.cost_type_id,
                rate_id: src.rate_id,
                description: src.description,
                zone_id: targetZone,
                floor_from: targetFloorFrom,
                floor_to: targetFloorTo,
                room_type_id: targetRoom,
                volume_type: src.volume_type,
              });
              if (body.skipExisting && existing.has(key)) {
                skipped++;
                continue;
              }
              existing.add(key);

              const { rows: ins } = await client.query(
                `INSERT INTO estimate_items
                   (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order,
                    zone_id, floor_from, floor_to, room_type_id, locations, volume_type, source, needs_review,
                    copy_batch_id, copy_source_item_id, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $17, 'manual', false, $14, $15, $16, $16)
                 RETURNING *`,
                [
                  eid, src.cost_type_id, src.rate_id, src.description, src.quantity, src.unit,
                  src.unit_price, src.sort_order, targetZone, targetFloorFrom, targetFloorTo, targetRoom,
                  JSON.stringify(legacyToLocations(targetZone, targetFloorFrom, targetFloorTo)),
                  copyBatchId, src.id, request.currentUser.id, src.volume_type,
                ],
              );
              const copy = ins[0];
              createdWorks++;
              audits.push({
                estimateId: eid, projectId, entityType: 'estimate_item', entityId: copy.id,
                action: 'create', userId: request.currentUser.id,
                changes: { after: copy, copySourceItemId: src.id, copyBatchId },
                correlationId: copyBatchId,
              });

              if (body.includeMaterials) {
                const { rows: mats } = await client.query(
                  `INSERT INTO estimate_materials
                     (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status, created_by, updated_by)
                   SELECT $1, $2, m.material_id, m.description, m.quantity, m.unit, m.unit_price, m.sort_order, m.status, $3, $3
                   FROM estimate_materials m WHERE m.item_id = $4
                   RETURNING *`,
                  [copy.id, eid, request.currentUser.id, src.id],
                );
                createdMaterials += mats.length;
                for (const m of mats) {
                  audits.push({
                    estimateId: eid, projectId, entityType: 'estimate_material', entityId: m.id as string,
                    action: 'create', userId: request.currentUser.id,
                    changes: { after: m, copyBatchId }, correlationId: copyBatchId,
                  });
                }
              }
            }
          }
        }

        // Сводная запись о батче тиражирования.
        audits.push({
          estimateId: eid, projectId, entityType: 'estimate', entityId: eid,
          action: 'create', userId: request.currentUser.id,
          changes: { copyBatchId, createdWorks, createdMaterials, skipped, sourceCount: sources.length },
          correlationId: copyBatchId,
        });
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        await emit('items_replicated', eid, projectId, request.currentUser.id, { correlationId: copyBatchId });
        return reply.send({
          created: { works: createdWorks, materials: createdMaterials },
          skipped,
          copyBatchId,
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // DELETE /api/estimates/:id/copy-batch/:batchId — откат батча тиражирования
  // (удаляет ровно созданные строки; материалы каскадом).
  fastify.delete<{ Params: { id: string; batchId: string } }>(
    '/:id/copy-batch/:batchId',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: works } = await client.query(
          'SELECT * FROM estimate_items WHERE estimate_id = $1 AND copy_batch_id = $2',
          [request.params.id, request.params.batchId],
        );
        if (works.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Батч тиражирования не найден' });
        }
        const ids = works.map((w) => w.id as string);
        await client.query('DELETE FROM estimate_items WHERE id = ANY($1::uuid[])', [ids]);
        const projectId = works[0].project_id ?? (await loadProjectId(client, request.params.id));
        await recordAuditBatch(
          client,
          works.map((w) => ({
            estimateId: request.params.id, projectId, entityType: 'estimate_item', entityId: w.id as string,
            action: 'delete', userId: request.currentUser.id,
            changes: { before: w, reason: 'replicate_undo' }, correlationId: request.params.batchId,
          })),
        );
        await client.query('COMMIT');
        await emit('bulk_deleted', request.params.id, projectId, request.currentUser.id, {
          correlationId: request.params.batchId,
        });
        return { success: true, deletedWorks: works.length };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}

// Get-or-create произвольного «типа» строки в рамках объекта (уникально по name_norm).
// Пустое имя/нет проекта → null (тип очищается). Имя триммится (в т.ч. в Zod-схеме).
async function upsertLocationType(
  db: Pick<PoolClient, 'query'>,
  projectId: string | null,
  rawName: string | null,
): Promise<string | null> {
  const name = (rawName ?? '').trim();
  if (!projectId || !name) return null;
  const { rows } = await db.query(
    `INSERT INTO project_location_types (project_id, name, name_norm)
     VALUES ($1, $2, lower(btrim($2)))
     ON CONFLICT (project_id, name_norm) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [projectId, name],
  );
  return (rows[0]?.id as string | undefined) ?? null;
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

type HistoryChangeView = { key: string; label: string; before: string | null; after: string | null };

// Маппинг строки audit_log в read-модель истории (snake → camel).
function mapAuditRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    estimateId: r.estimate_id,
    projectId: r.project_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action as string,
    userId: r.user_id,
    userName: r.user_name ?? null,
    correlationId: r.correlation_id ?? null,
    changes: (r.changes ?? null) as Record<string, unknown> | null,
    // Готовые к показу изменения (резолвятся в attachChangesView для update/confirm).
    changesView: null as HistoryChangeView[] | null,
    createdAt: r.created_at,
  };
}

// ---------- Человекочитаемая история: резолв UUID и форматирование ----------

// Поле-ссылка → справочник (whitelist; имена таблиц не из пользовательского ввода).
const HISTORY_REF_TABLE: Record<string, string> = {
  cost_type_id: 'cost_types',
  rate_id: 'rates',
  room_type_id: 'room_types',
  cost_category_id: 'cost_categories',
  material_id: 'material_catalog',
  location_type_id: 'project_location_types',
  zone_id: 'project_zones',
};

// Русские подписи полей журнала.
const HISTORY_FIELD_LABEL: Record<string, string> = {
  description: 'наименование',
  quantity: 'кол-во',
  unit: 'ед.',
  unit_price: 'цена',
  needs_review: 'согласование',
  status: 'статус',
  sort_order: 'порядок',
  cost_type_id: 'вид работ',
  rate_id: 'расценка',
  cost_category_id: 'категория',
  room_type_id: 'тип помещения',
  material_id: 'материал',
  location_type_id: 'тип',
  zone_id: 'корпус/зона',
  floor_from: 'этаж с',
  floor_to: 'этаж по',
  locations: 'местоположение',
  volume_type: 'тип объёма',
  work_type: 'вид работ',
  notes: 'примечания',
};

// Свернуть набор этажей в строку «-1-4, 6» (смежность учитывает пропуск нуля).
function formatFloorsList(floors: number[]): string {
  const uniq = [...new Set(floors)].sort((a, b) => a - b);
  if (uniq.length === 0) return '';
  const parts: string[] = [];
  const flush = (a: number, b: number) => parts.push(a === b ? `${a}` : `${a}-${b}`);
  let start = uniq[0]!;
  let prev = uniq[0]!;
  for (let k = 1; k < uniq.length; k++) {
    const cur = uniq[k]!;
    const expected = prev === -1 ? 1 : prev + 1;
    if (cur === expected) { prev = cur; continue; }
    flush(start, prev);
    start = cur;
    prev = cur;
  }
  flush(start, prev);
  return parts.join(', ');
}

// Форматировать jsonb locations: «Корпус 1: эт. 3-5; Корпус 2: эт. 3-5».
function formatLocationsValue(value: unknown, zoneNames: Map<string, string>): string {
  if (!Array.isArray(value) || value.length === 0) return '—';
  return value
    .map((loc) => {
      const l = loc as { zoneId?: string | null; floors?: number[] };
      const zoneName = l.zoneId ? zoneNames.get(l.zoneId) ?? 'Зона' : 'Без зоны';
      const fl = formatFloorsList(Array.isArray(l.floors) ? l.floors : []);
      return fl ? `${zoneName}: эт. ${fl}` : zoneName;
    })
    .join('; ');
}

// Значение поля «до»/«после» как строка (null → рисуется «—» на клиенте).
function formatHistoryValue(
  field: string,
  value: unknown,
  names: Map<string, Map<string, string>>,
): string | null {
  const zoneNames = names.get('project_zones') ?? new Map<string, string>();
  if (field === 'locations') return formatLocationsValue(value, zoneNames);
  if (value == null) return null;
  const table = HISTORY_REF_TABLE[field];
  if (table) return names.get(table)?.get(String(value)) ?? null;
  if (field === 'needs_review') return value ? 'требует проверки' : 'согласовано';
  if (field === 'volume_type') return value === 'additional' ? 'дополнительный' : 'основной';
  return String(value);
}

// Для каждой update/confirm-записи собрать changesView: резолвить UUID и форматировать.
async function attachChangesView(pool: Pool, entries: ReturnType<typeof mapAuditRow>[]): Promise<void> {
  // 1. Собрать id по справочникам из всех изменений.
  const idsByTable = new Map<string, Set<string>>();
  const addId = (table: string, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    if (!idsByTable.has(table)) idsByTable.set(table, new Set());
    idsByTable.get(table)!.add(id);
  };
  for (const e of entries) {
    if (e.action !== 'update' && e.action !== 'confirm') continue;
    const fields = e.changes?.changedFields;
    if (!Array.isArray(fields)) continue;
    const before = (e.changes?.before ?? {}) as Record<string, unknown>;
    const after = (e.changes?.after ?? {}) as Record<string, unknown>;
    for (const f of fields as string[]) {
      if (f === 'locations') {
        for (const side of [before[f], after[f]]) {
          if (Array.isArray(side)) for (const loc of side) addId('project_zones', (loc as { zoneId?: unknown })?.zoneId);
        }
      } else if (HISTORY_REF_TABLE[f]) {
        addId(HISTORY_REF_TABLE[f]!, before[f]);
        addId(HISTORY_REF_TABLE[f]!, after[f]);
      }
    }
  }
  // 2. Батч-резолв имён.
  const names = new Map<string, Map<string, string>>();
  for (const [table, ids] of idsByTable) {
    if (!ids.size) continue;
    const { rows } = await pool.query(`SELECT id, name FROM ${table} WHERE id = ANY($1::uuid[])`, [[...ids]]);
    names.set(table, new Map(rows.map((r) => [r.id as string, r.name as string])));
  }
  // 3. Построить changesView (locations скрывает производные zone_id/floor_from/floor_to).
  for (const e of entries) {
    if (e.action !== 'update' && e.action !== 'confirm') continue;
    const fields = e.changes?.changedFields;
    if (!Array.isArray(fields) || fields.length === 0) continue;
    const before = (e.changes?.before ?? {}) as Record<string, unknown>;
    const after = (e.changes?.after ?? {}) as Record<string, unknown>;
    const hasLocations = (fields as string[]).includes('locations');
    e.changesView = (fields as string[])
      .filter((f) => !(hasLocations && (f === 'zone_id' || f === 'floor_from' || f === 'floor_to')))
      .map((f) => ({
        key: f,
        label: HISTORY_FIELD_LABEL[f] ?? f,
        before: formatHistoryValue(f, before[f], names),
        after: formatHistoryValue(f, after[f], names),
      }));
  }
}
