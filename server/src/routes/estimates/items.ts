import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit, recordAuditBatch, diffChanges, type AuditInput } from '../../lib/audit.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { legacyToLocations, deriveLegacyLocation, upsertLocationType } from '../../lib/location.js';
import {
  createEstimateItemSchema,
  updateEstimateItemSchema,
  reorderEstimateItemsSchema,
  setEstimateItemsVolumeTypeSchema,
} from '@estimat/shared';

// Работы (строки сметы): создание, правка, перестановка, тип объёма, удаление.
export function registerItemRoutes(fastify: FastifyInstance): void {
  // POST /api/estimates/:id/items — создать работу
  fastify.post<{ Params: { id: string } }>(
    '/:id/items',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = createEstimateItemSchema.parse(request.body);
      // Единая correlation-группа жеста (работа + авто-материалы) — единица отмены (undo).
      const correlationId = randomUUID();
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
          correlationId,
          changes: { after: item, undoable: true, operationKind: 'item_create' },
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
              correlationId,
              changes: { after: m, source: 'suggested', undoable: true, operationKind: 'item_create' },
            })),
          );
        }
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'item_created', request.params.id, item.project_id, request.currentUser.id, { auditLogId: auditId });
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
  fastify.put<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateEstimateItemSchema.parse(request.body);
    // Единая correlation-группа правки (работа + пересчитанные материалы) — единица отмены.
    const correlationId = randomUUID();
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
        correlationId,
        // afterVersion — итоговая версия строки: отмена сверяет её с текущей (OCC), чтобы не
        // затереть чужую позднюю правку. undoable/operationKind — маркеры единицы отмены.
        changes: { ...diffChanges(oldRows[0], rows[0], fields), afterVersion: rows[0].version, undoable: true, operationKind: 'item_update' },
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
           RETURNING em.id, em.quantity, em.version, before.quantity AS old_quantity`,
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
              correlationId,
              changes: {
                before: { quantity: m.old_quantity },
                after: { quantity: m.quantity },
                changedFields: ['quantity'],
                reason: 'work_quantity_changed',
                afterVersion: m.version,
                undoable: true,
                operationKind: 'item_update',
              },
            })),
          );
        }
      }
      await client.query('COMMIT');
      await emitEstimateChanged(fastify, 'item_updated', rows[0].estimate_id, rows[0].project_id, request.currentUser.id, { auditLogId: auditId });
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
  fastify.patch<{ Params: { id: string } }>('/:id/items/reorder', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
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
      if (rowCount) await emitEstimateChanged(fastify, 'item_updated', request.params.id, projectId, request.currentUser.id);
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
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
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
        if (rows.length) await emitEstimateChanged(fastify, 'item_updated', eid, projectId, request.currentUser.id);
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
  // DELETE /api/estimates/items/:id — удалить работу (материалы каскадом; snapshot обоих в журнал)
  fastify.delete<{ Params: { id: string } }>('/items/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    // Единая correlation-группа удаления (работа + каскадные материалы) — единица отмены.
    const correlationId = randomUUID();
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
          action: 'delete', userId: request.currentUser.id, correlationId,
          changes: { before: work[0], undoable: true, operationKind: 'item_delete' },
        },
        ...mats.map((m) => ({
          estimateId, projectId, entityType: 'estimate_material', entityId: m.id as string,
          action: 'delete', userId: request.currentUser.id, correlationId,
          changes: { before: m, reason: 'cascade', undoable: true, operationKind: 'item_delete' },
        })),
      ];
      await recordAuditBatch(client, audits);
      await client.query('COMMIT');
      await emitEstimateChanged(fastify, 'item_deleted', estimateId, projectId, request.currentUser.id);
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
