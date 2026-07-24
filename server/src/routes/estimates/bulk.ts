import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAuditBatch, diffChanges, type AuditInput } from '../../lib/audit.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { legacyToLocations, deriveLegacyLocation, upsertLocationType } from '../../lib/location.js';
import { mirrorMaterialsToCatalog, relinkMaterialRequestsToCatalog } from '../../lib/catalog.js';
import { lockEstimateRequests } from '../../lib/material-requests/access.js';
import {
  bulkDeleteEstimateItemsSchema,
  bulkConfirmEstimateItemsSchema,
  bulkAssignEstimateItemsLocationSchema,
  replicateItemsSchema,
  type LocationEntry,
} from '@estimat/shared';

// Массовые операции: согласование, назначение локации, удаление, тиражирование и его откат.
export function registerBulkRoutes(fastify: FastifyInstance): void {
  // POST /api/estimates/:id/confirm-all — согласовать все ИИ-позиции (снять needs_review),
  // row-level аудит по каждой затронутой работе/материалу.
  fastify.post<{ Params: { id: string } }>('/:id/confirm-all', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      // Сериализуем согласование и создание заявок по одной смете, чтобы новая строка заявки
      // не появилась между relink и её пропуском (см. relinkMaterialRequestsToCatalog).
      await lockEstimateRequests(client, request.params.id);
      const works = await client.query(
        'UPDATE estimate_items SET needs_review = false, updated_by = $2 WHERE estimate_id = $1 AND needs_review = true RETURNING id, estimate_id, project_id',
        [request.params.id, request.currentUser.id],
      );
      const materials = await client.query(
        'UPDATE estimate_materials SET needs_review = false, updated_by = $2 WHERE estimate_id = $1 AND needs_review = true RETURNING id, estimate_id',
        [request.params.id, request.currentUser.id],
      );
      // Согласованные материалы зеркалируются в legacy-справочник (как в bulk-confirm) —
      // mirror сам отфильтрует привязанные к каталогу.
      const catalogChanged = await mirrorMaterialsToCatalog(client, materials.rows.map((r) => r.id as string), request.currentUser.id);
      // Привязка к каталогу сменила agg_key согласованных материалов — переносим строки заявок
      // с txt-ключа на id-ключ (только полностью разрешённые бакеты).
      await relinkMaterialRequestsToCatalog(client, request.params.id);
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
      if (audits.length) await emitEstimateChanged(fastify, 'confirmed_all', request.params.id, projectId, request.currentUser.id);
      return reply.send({ works: works.rowCount ?? 0, materials: materials.rowCount ?? 0, catalogChanged });
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
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      if (!estimateId.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const { workIds, materialIds } = bulkConfirmEstimateItemsSchema.parse(request.body);
      const eid = estimateId.data;

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // Сериализуем согласование и создание заявок по одной смете (см. confirm-all).
        await lockEstimateRequests(client, eid);
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
        const catalogChanged = await mirrorMaterialsToCatalog(
          client,
          materials.rows.map((r) => r.id as string),
          request.currentUser.id,
        );
        // Перенос строк заявок с txt-ключа на id-ключ после привязки материалов к каталогу.
        await relinkMaterialRequestsToCatalog(client, eid);

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
        if (audits.length) await emitEstimateChanged(fastify, 'confirmed_all', eid, projectId, request.currentUser.id);
        return reply.send({ works: works.rowCount ?? 0, materials: materials.rowCount ?? 0, catalogChanged });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // POST /api/estimates/:id/bulk-assign-location — массово скопировать параметры на выбранные работы:
  // местоположение (locations — источник истины + зеркало zone_id/floor_from/floor_to) и/или произвольный
  // «тип» строки. Непереданный параметр не перезаписывается. Аудит — с before/after по каждой строке
  // (diffChanges) только по реально обновляемым полям.
  fastify.post<{ Params: { id: string } }>(
    '/:id/bulk-assign-location',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const eid = z.string().uuid().safeParse(request.params.id);
      if (!eid.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const { workIds, locations, locationTypeName } = bulkAssignEstimateItemsLocationSchema.parse(request.body);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // projectId нужен до UPDATE — для upsert-а «типа» в справочник типов объекта.
        const projectId = await loadProjectId(client, eid.data);
        const locationTypeId = locationTypeName !== undefined
          ? await upsertLocationType(client, projectId, locationTypeName)
          : undefined;
        const { rows: oldRows } = await client.query(
          'SELECT * FROM estimate_items WHERE estimate_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE',
          [eid.data, workIds],
        );
        const oldById = new Map(oldRows.map((r) => [r.id as string, r]));
        // Условная сборка SET: обновляем только переданные параметры.
        const sets: string[] = [];
        const params: unknown[] = [];
        const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
        if (locations) {
          const primary = deriveLegacyLocation(locations);
          sets.push(`locations = ${bind(JSON.stringify(locations))}::jsonb`);
          sets.push(`zone_id = ${bind(primary.zoneId)}`);
          sets.push(`floor_from = ${bind(primary.floorFrom)}`);
          sets.push(`floor_to = ${bind(primary.floorTo)}`);
        }
        if (locationTypeName !== undefined) sets.push(`location_type_id = ${bind(locationTypeId)}`);
        sets.push(`updated_by = ${bind(request.currentUser.id)}`);
        const { rows } = await client.query(
          `UPDATE estimate_items
              SET ${sets.join(', ')}
            WHERE estimate_id = ${bind(eid.data)} AND id = ANY(${bind(workIds)}::uuid[])
            RETURNING *`,
          params,
        );
        const auditFields = [
          ...(locations ? ['locations', 'zone_id', 'floor_from', 'floor_to'] : []),
          ...(locationTypeName !== undefined ? ['location_type_id'] : []),
        ];
        const audits: AuditInput[] = rows.map((r) => ({
          estimateId: eid.data,
          projectId,
          entityType: 'estimate_item',
          entityId: r.id as string,
          action: 'update',
          userId: request.currentUser.id,
          changes: diffChanges(oldById.get(r.id as string)!, r, auditFields),
        }));
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        if (rows.length) await emitEstimateChanged(fastify, 'item_updated', eid.data, projectId, request.currentUser.id);
        return reply.send({ updated: rows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
  // POST /api/estimates/:id/bulk-delete — массовое удаление работ (с каскадом материалов) и материалов.
  fastify.post<{ Params: { id: string } }>(
    '/:id/bulk-delete',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      if (!estimateId.success) return reply.status(400).send({ error: 'Некорректный id сметы' });
      const { workIds, materialIds } = bulkDeleteEstimateItemsSchema.parse(request.body);
      const eid = estimateId.data;

      // Единая correlation-группа массового удаления — единица отмены (undo восстанавливает всё).
      const correlationId = randomUUID();
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
            audits.push({ estimateId: eid, projectId, entityType: 'estimate_item', entityId: w.id, action: 'delete', userId: request.currentUser.id, correlationId, changes: { before: w, undoable: true, operationKind: 'bulk_delete' } });
          }
          for (const m of cascade) {
            audits.push({ estimateId: eid, projectId, entityType: 'estimate_material', entityId: m.id, action: 'delete', userId: request.currentUser.id, correlationId, changes: { before: m, reason: 'cascade', undoable: true, operationKind: 'bulk_delete' } });
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
            audits.push({ estimateId: eid, projectId, entityType: 'estimate_material', entityId: m.id, action: 'delete', userId: request.currentUser.id, correlationId, changes: { before: m, undoable: true, operationKind: 'bulk_delete' } });
          }
        }
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'bulk_deleted', eid, projectId, request.currentUser.id);
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
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
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
        location_type_id: unknown; volume_type: unknown;
      }) =>
        [r.cost_type_id, r.rate_id ?? r.description, r.zone_id, r.floor_from, r.floor_to, r.room_type_id, r.location_type_id, r.volume_type].join('|');

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
            'SELECT cost_type_id, rate_id, description, zone_id, floor_from, floor_to, room_type_id, location_type_id, volume_type FROM estimate_items WHERE estimate_id = $1',
            [eid],
          );
          for (const r of all) existing.add(dupKey(r));
        }

        const projectId = await loadProjectId(client, eid);
        // Целевой «тип» — одна координата-override: upsert один раз (undefined = брать из источника).
        const overrideTypeId = body.locationTypeName?.trim()
          ? await upsertLocationType(client, projectId, body.locationTypeName)
          : undefined;
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
              const targetLocationTypeId = overrideTypeId ?? src.location_type_id;

              // locations без потери мультизоны/точных этажей: без override зоны и этажей —
              // сохраняем источник как есть; иначе строим одну зону/диапазон из legacy-полей.
              const targetLocations =
                zone === undefined && !hasFloorOverride && Array.isArray(src.locations) && src.locations.length > 0
                  ? (src.locations as LocationEntry[])
                  : legacyToLocations(targetZone, targetFloorFrom, targetFloorTo);
              // Legacy-зеркало (участвует в ключе дублей) выводим из итоговых locations — единообразно с create/update.
              const primary = deriveLegacyLocation(targetLocations);

              const key = dupKey({
                cost_type_id: src.cost_type_id,
                rate_id: src.rate_id,
                description: src.description,
                zone_id: primary.zoneId,
                floor_from: primary.floorFrom,
                floor_to: primary.floorTo,
                room_type_id: targetRoom,
                location_type_id: targetLocationTypeId,
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
                    zone_id, floor_from, floor_to, room_type_id, location_type_id, locations, volume_type, source, needs_review,
                    copy_batch_id, copy_source_item_id, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $18, $13::jsonb, $17, 'manual', false, $14, $15, $16, $16)
                 RETURNING *`,
                [
                  eid, src.cost_type_id, src.rate_id, src.description, src.quantity, src.unit,
                  src.unit_price, src.sort_order, primary.zoneId, primary.floorFrom, primary.floorTo, targetRoom,
                  JSON.stringify(targetLocations),
                  copyBatchId, src.id, request.currentUser.id, src.volume_type, targetLocationTypeId,
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
        await emitEstimateChanged(fastify, 'items_replicated', eid, projectId, request.currentUser.id, { correlationId: copyBatchId });
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
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
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
        await emitEstimateChanged(fastify, 'bulk_deleted', request.params.id, projectId, request.currentUser.id, {
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
