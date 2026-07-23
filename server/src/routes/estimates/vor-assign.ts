// Назначение и снятие подрядчика на ВОР (раздел «Подрядчики») и состав ВОР для отборов.
// Это единственный путь, которым подрядчик попадает на строки сметы и уходит с них.
//
// Состав назначения сервер собирает САМ по vorId: клиент присылает только подрядчика и отборы,
// поэтому назначить работу вне этого ВОР невозможно даже подделанным запросом — предел области
// задаёт сам состав ВОР.
//
// Локация и тип строки берутся ИСТОРИЧЕСКИЕ — из построчного снимка ВОР: отбирать надо по тому,
// что подрядчик видит в присланном файле, а не по тому, во что строку успели переправить после
// выгрузки. Категории и вида работ в файле ВОР нет вовсе, поэтому по ним отбор идёт по текущей
// смете. Строки, удалённые из сметы, не назначаются (см. filterVorScope).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { requireRole } from '../../middleware/requireRole.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { recordAuditBatch } from '../../lib/audit.js';
import { lockEstimateRequests } from '../../lib/material-requests/access.js';
import { loadScopeRows, planBulkAssign, blockedForContractor } from '../../lib/contractors/bulk-assign.js';
import { clearStaleContractPrices } from '../../lib/vor/contract-prices.js';
import {
  loadWorkbook,
  matchVorPrices,
  parseFilledVorWorkbook,
  VorPriceParseError,
  type MatchedPrice,
} from '../../lib/vor/prices.js';
import { loadVorItemStates, loadVorManifest, type VorSnapshotMeta } from './vor.js';
import {
  filterVorScope,
  NON_CONTRACTOR_ROLES,
  vorAssignInputSchema,
  type VorItemState,
  type VorPriceIssue,
  type VorScopeItem,
} from '@estimat/shared';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Запись ВОР со всем, что нужно для состава и импорта цен. */
export interface VorRecord extends VorSnapshotMeta {
  id: string;
  estimateId: string;
}

/** Найти ВОР в пределах сметы. null — чужой или несуществующий (наружу → 404). */
export async function findVor(pool: Pool, estimateId: string, vorId: string): Promise<VorRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, estimate_id, snapshot_key, snapshot_checksum, content_schema_version
       FROM estimate_vors WHERE id = $1 AND estimate_id = $2`,
    [vorId, estimateId],
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id as string,
    estimateId: rows[0].estimate_id as string,
    snapshotKey: rows[0].snapshot_key as string | null,
    snapshotChecksum: rows[0].snapshot_checksum as Buffer | null,
    version: rows[0].content_schema_version as number,
  };
}

/** Зоны строки сметы: мультизона (locations) с запасным вариантом на легаси-поле zone_id. */
function currentZoneIds(locations: unknown, zoneId: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(locations)) {
    for (const l of locations) {
      const id = (l as { zoneId?: unknown } | null)?.zoneId;
      if (typeof id === 'string') out.add(id);
    }
  }
  if (out.size === 0 && typeof zoneId === 'string') out.add(zoneId);
  return [...out];
}

/**
 * Состав ВОР для интерфейса отбора: строка + её значения (исторические там, где снимок их знает)
 * + текущее состояние (кому назначена, защищена ли заявкой, жива ли).
 */
export async function loadVorScopeItems(
  fastify: FastifyInstance,
  vor: VorRecord,
): Promise<VorScopeItem[]> {
  const { rows } = await fastify.pool.query(
    `SELECT vi.item_id,
            ei.id AS live_id, ei.description, ei.locations, ei.zone_id,
            ei.cost_category_id, cc.name AS cost_category_name,
            ei.cost_type_id,     ct.name AS cost_type_name,
            ei.location_type_id, lt.name AS location_type_name
       FROM estimate_vor_items vi
       LEFT JOIN estimate_items ei        ON ei.id = vi.item_id AND ei.estimate_id = $2
       LEFT JOIN cost_categories cc       ON cc.id = ei.cost_category_id
       LEFT JOIN cost_types ct            ON ct.id = ei.cost_type_id
       LEFT JOIN project_location_types lt ON lt.id = ei.location_type_id
      WHERE vi.vor_id = $1`,
    [vor.id, vor.estimateId],
  );
  const itemIds = rows.map((r) => r.item_id as string);
  if (itemIds.length === 0) return [];

  // Снимок: локации (структурно, по zoneId) и тип — как их видел файл ВОР.
  const manifest = await loadVorManifest(fastify, vor);
  const snapById = new Map((manifest?.items ?? []).map((it) => [it.itemId, it]));

  // Исторический тип — текстовое имя; в id справочника его резолвим по объекту (имя типа
  // уникально в рамках объекта). Не резолвится (тип переименован/удалён) — берём текущий.
  const { rows: ltRows } = await fastify.pool.query(
    `SELECT lt.id, lt.name
       FROM project_location_types lt
       JOIN estimates e ON e.project_id = lt.project_id
      WHERE e.id = $1`,
    [vor.estimateId],
  );
  const typeIdByName = new Map(ltRows.map((r) => [(r.name as string).trim(), r.id as string]));

  // Имена зон — по всем встреченным id (исторические + текущие).
  const zoneIds = new Set<string>();
  for (const r of rows) {
    for (const id of currentZoneIds(r.locations, r.zone_id)) zoneIds.add(id);
    for (const l of snapById.get(r.item_id as string)?.locations ?? []) if (l.zoneId) zoneIds.add(l.zoneId);
  }
  const zoneNameById = new Map<string, string>();
  if (zoneIds.size) {
    const { rows: zr } = await fastify.pool.query(
      'SELECT id, name FROM project_zones WHERE id = ANY($1::uuid[])',
      [[...zoneIds]],
    );
    for (const z of zr) zoneNameById.set(z.id as string, z.name as string);
  }

  const { rows: assigned } = await fastify.pool.query(
    'SELECT item_id, contractor_id FROM estimate_item_contractors WHERE item_id = ANY($1::uuid[])',
    [itemIds],
  );
  const contractorsByItem = new Map<string, string[]>();
  for (const a of assigned) {
    const key = a.item_id as string;
    const list = contractorsByItem.get(key) ?? [];
    list.push(a.contractor_id as string);
    contractorsByItem.set(key, list);
  }

  // Защита заявками — тем же расчётом, что и при назначении (читаем по пулу, вне транзакции).
  const scopeRows = await loadScopeRows(fastify.pool, {
    estimateId: vor.estimateId,
    itemIds,
    targetContractorId: null,
  });
  const lockedIds = new Set(
    scopeRows.filter((r) => r.lockedLinked.length > 0 || r.lockedLegacy.length > 0).map((r) => r.itemId),
  );

  const stateByItem = new Map<string, VorItemState>(
    (await loadVorItemStates(fastify, vor.estimateId))
      .filter((s) => s.vorId === vor.id)
      .map((s) => [s.itemId, s.state]),
  );

  return rows.map((r) => {
    const itemId = r.item_id as string;
    const snap = snapById.get(itemId);
    const alive = r.live_id !== null;
    // Историческая локация приоритетнее текущей: подрядчик отбирает по присланному файлу.
    const snapZoneIds = (snap?.locations ?? []).map((l) => l.zoneId).filter((z): z is string => !!z);
    const effectiveZoneIds = snap ? snapZoneIds : currentZoneIds(r.locations, r.zone_id);
    const snapTypeName = (snap?.typeName ?? '').trim();
    const snapTypeId = snapTypeName ? typeIdByName.get(snapTypeName) ?? null : null;
    return {
      itemId,
      description: (r.description as string | null) ?? snap?.name ?? '',
      snapshotLocationLabel: snap?.locationLabel || null,
      snapshotTypeName: snap?.typeName ?? null,
      costCategoryId: (r.cost_category_id as string | null) ?? null,
      costCategoryName: (r.cost_category_name as string | null) ?? null,
      costTypeId: (r.cost_type_id as string | null) ?? null,
      costTypeName: (r.cost_type_name as string | null) ?? null,
      zones: effectiveZoneIds.map((id) => ({ id, name: zoneNameById.get(id) ?? '(удалено)' })),
      locationTypeId: snapTypeName ? snapTypeId : (r.location_type_id as string | null) ?? null,
      locationTypeName: snapTypeName || ((r.location_type_name as string | null) ?? null),
      assignedContractorIds: contractorsByItem.get(itemId) ?? [],
      requestLocked: lockedIds.has(itemId),
      state: alive ? stateByItem.get(itemId) ?? 'unknown' : 'deleted',
    };
  });
}

/** Общий вход роутов: валидация id, доступ к смете, поиск ВОР. */
async function resolveVor(
  fastify: FastifyInstance,
  request: FastifyRequest<{ Params: { id: string; vorId: string } }>,
): Promise<{ error: { status: number; message: string } } | { vor: VorRecord }> {
  const id = z.string().uuid().safeParse(request.params.id);
  const vorId = z.string().uuid().safeParse(request.params.vorId);
  if (!id.success || !vorId.success) return { error: { status: 400, message: 'Некорректный id' } };
  try {
    await assertEstimateAccess(fastify.pool, id.data, request.currentUser);
  } catch (err) {
    if (err instanceof ChatAccessError) return { error: { status: err.status, message: err.message } };
    throw err;
  }
  const vor = await findVor(fastify.pool, id.data, vorId.data);
  if (!vor) return { error: { status: 404, message: 'ВОР не найден' } };
  return { vor };
}

/** Позиция, из-за которой импорт цен отклонён (наружу — списком в теле 409). */
function toIssue(m: MatchedPrice, kind: 'work' | 'material'): VorPriceIssue {
  return {
    kind,
    number: m.number,
    name: m.name,
    reason: (m.reason ?? 'not_matched') as VorPriceIssue['reason'],
  };
}

export function registerVorAssignRoutes(fastify: FastifyInstance): void {
  const ROLES = NON_CONTRACTOR_ROLES;

  // GET /:id/vors/:vorId/items — состав ВОР: строки с их значениями отбора и текущим статусом.
  fastify.get<{ Params: { id: string; vorId: string } }>(
    '/:id/vors/:vorId/items',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const resolved = await resolveVor(fastify, request);
      if ('error' in resolved)
        return reply.status(resolved.error.status).send({ error: resolved.error.message });
      const items = await loadVorScopeItems(fastify, resolved.vor);
      // Цены грузятся только к ВОР с построчным снимком: у легаси-выгрузок сопоставить строки
      // файла не с чем, и шаг загрузки в интерфейсе не предлагается.
      const pricesAvailable = resolved.vor.version >= 1 && !!resolved.vor.snapshotKey;
      return reply.send({ data: { items, pricesAvailable } });
    },
  );

  // POST /:id/vors/:vorId/assign — назначить подрядчика на весь ВОР либо на его часть.
  // Одна работа — один исполнитель: чужие назначения снимаются, объём отдаётся целиком.
  fastify.post<{ Params: { id: string; vorId: string } }>(
    '/:id/vors/:vorId/assign',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const resolved = await resolveVor(fastify, request);
      if ('error' in resolved)
        return reply.status(resolved.error.status).send({ error: resolved.error.message });
      const parsed = vorAssignInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Некорректный запрос назначения' });
      const body = parsed.data;
      const { vor } = resolved;

      const all = await loadVorScopeItems(fastify, vor);
      const selected = filterVorScope(all, body.scope, body.filters);
      const deletedSkipped = all.filter((it) => it.state === 'deleted').length;
      if (selected.length === 0) {
        return reply.send({
          data: { assigned: 0, replacedRows: 0, blocked: [], deletedSkipped, clearedPrices: 0 },
        });
      }

      const contractorExists = await fastify.pool.query(
        'SELECT 1 FROM organizations WHERE id = $1',
        [body.contractorId],
      );
      if (contractorExists.rowCount === 0)
        return reply.status(400).send({ error: 'Подрядчик не найден' });

      const userId = request.currentUser.id;
      const itemIds = selected.map((it) => it.itemId);
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // ПЕРВЫМ после BEGIN, до row-lock: тот же advisory-lock берут создание и пересборка
        // заявки — без него заявка может появиться между проверкой защиты и снятием назначения.
        await lockEstimateRequests(client, vor.estimateId);
        await client.query(
          `SELECT id FROM estimate_items
            WHERE id = ANY($1::uuid[]) AND estimate_id = $2::uuid
            ORDER BY id
              FOR UPDATE`,
          [itemIds, vor.estimateId],
        );

        const rows = await loadScopeRows(client, {
          estimateId: vor.estimateId,
          itemIds,
          targetContractorId: body.contractorId,
        });
        const plan = planBulkAssign(rows, 'replace');

        // Снятие чужих — строго ДО вставки: на строке может быть только один исполнитель
        // (uq_eic_item, 0083), и снятые записи нужны для аудита и счётчика перезаписей.
        let removedRows: Record<string, unknown>[] = [];
        if (plan.removeItemIds.length > 0) {
          const res = await client.query(
            `DELETE FROM estimate_item_contractors
              WHERE item_id = ANY($1::uuid[]) AND contractor_id <> $2::uuid
              RETURNING *`,
            [plan.removeItemIds, body.contractorId],
          );
          removedRows = res.rows;
        }

        let assignedRows: Record<string, unknown>[] = [];
        if (plan.assignItemIds.length > 0) {
          // Конфликт по item_id, а не по паре: строка достаётся подрядчику целиком, и остаточная
          // чужая запись (гонка) должна перезаписаться, а не уронить запрос уникальностью.
          const res = await client.query(
            `INSERT INTO estimate_item_contractors
               (item_id, estimate_id, contractor_id, assigned_by)
             SELECT x, $2::uuid, $3::uuid, $4::uuid
               FROM unnest($1::uuid[]) AS x
             ON CONFLICT (item_id)
               DO UPDATE SET contractor_id = EXCLUDED.contractor_id,
                             assigned_by = EXCLUDED.assigned_by,
                             updated_at = now()
             RETURNING *`,
            [plan.assignItemIds, vor.estimateId, body.contractorId, userId],
          );
          assignedRows = res.rows;

          // Объект сметы становится виден подрядчику в его кабинете.
          await client.query(
            `INSERT INTO project_contractors (project_id, contractor_id, assigned_by)
             SELECT DISTINCT e.project_id, $2::uuid, $3::uuid
               FROM estimates e
              WHERE e.id = $1::uuid AND e.project_id IS NOT NULL
             ON CONFLICT (project_id, contractor_id) DO NOTHING`,
            [vor.estimateId, body.contractorId, userId],
          );

          // Реквизиты договора: форма приходит с подставленными текущими значениями, поэтому
          // пустое поле — осознанная очистка, а не «не менять».
          await client.query(
            `INSERT INTO estimate_vor_contractors
               (vor_id, contractor_id, contract_number, contract_date, assigned_by)
             VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::uuid)
             ON CONFLICT (vor_id, contractor_id)
               DO UPDATE SET contract_number = EXCLUDED.contract_number,
                             contract_date   = EXCLUDED.contract_date,
                             updated_at      = now()`,
            [vor.id, body.contractorId, body.contractNumber ?? null, body.contractDate ?? null, userId],
          );
        }

        // Подрядчик, у которого в этом ВОР не осталось ни одной строки (его перезаписали
        // целиком), из реестра договоров уходит — иначе в столбце «Подрядчики» висел бы тот,
        // кто здесь уже ничего не делает.
        await client.query(
          `DELETE FROM estimate_vor_contractors vc
            WHERE vc.vor_id = $1::uuid
              AND NOT EXISTS (
                SELECT 1 FROM estimate_vor_items vi
                  JOIN estimate_item_contractors eic
                    ON eic.item_id = vi.item_id AND eic.contractor_id = vc.contractor_id
                 WHERE vi.vor_id = vc.vor_id)`,
          [vor.id],
        );

        // Договорные цены прежних исполнителей — снять: новому подрядчику чужой прайс не наследуется.
        const clearedPrices = await clearStaleContractPrices(client, itemIds);

        const auditInputs = [
          ...removedRows.map((r) => ({
            estimateId: r.estimate_id as string,
            entityType: 'estimate_item_contractor',
            entityId: r.id as string,
            action: 'delete',
            userId,
            changes: { before: r, reason: 'vor_assign' },
          })),
          ...assignedRows.map((r) => ({
            estimateId: r.estimate_id as string,
            entityType: 'estimate_item_contractor',
            entityId: r.id as string,
            action: 'update',
            userId,
            changes: { after: r, reason: 'vor_assign', vorId: vor.id },
          })),
        ];
        for (let i = 0; i < auditInputs.length; i += 500) {
          await recordAuditBatch(client, auditInputs.slice(i, i + 500));
        }

        await client.query('COMMIT');

        if (assignedRows.length > 0 || removedRows.length > 0 || clearedPrices > 0) {
          const projectId = await loadProjectId(fastify.pool, vor.estimateId);
          await emitEstimateChanged(fastify, 'contractor_set', vor.estimateId, projectId, userId);
        }

        return reply.send({
          data: {
            assigned: assignedRows.length,
            replacedRows: plan.replacedRows,
            blocked: plan.blocked,
            deletedSkipped,
            clearedPrices,
          },
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // DELETE /:id/vors/:vorId/contractors/:contractorId — снять подрядчика со всех строк этого ВОР.
  //
  // Обратная операция к назначению и единственный способ снятия: в смете исполнителя больше не
  // трогают. Строка, по которой этот подрядчик уже оформил заявку на материалы, остаётся за ним —
  // иначе заявка осталась бы без сметного основания; чужие заявки снятию не мешают.
  fastify.delete<{ Params: { id: string; vorId: string; contractorId: string } }>(
    '/:id/vors/:vorId/contractors/:contractorId',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const resolved = await resolveVor(fastify, request);
      if ('error' in resolved)
        return reply.status(resolved.error.status).send({ error: resolved.error.message });
      const contractorId = z.string().uuid().safeParse(request.params.contractorId);
      if (!contractorId.success) return reply.status(400).send({ error: 'Некорректный id подрядчика' });
      const { vor } = resolved;
      const userId = request.currentUser.id;

      const { rows: targetRows } = await fastify.pool.query(
        `SELECT vi.item_id
           FROM estimate_vor_items vi
           JOIN estimate_item_contractors eic
             ON eic.item_id = vi.item_id AND eic.contractor_id = $2::uuid
          WHERE vi.vor_id = $1::uuid`,
        [vor.id, contractorId.data],
      );
      const itemIds = targetRows.map((r) => r.item_id as string);

      // Строк за подрядчиком нет (сняли/удалили из сметы) — осталась только договорная запись.
      if (itemIds.length === 0) {
        await fastify.pool.query(
          'DELETE FROM estimate_vor_contractors WHERE vor_id = $1::uuid AND contractor_id = $2::uuid',
          [vor.id, contractorId.data],
        );
        return reply.send({ data: { cleared: 0, blocked: [], clearedPrices: 0 } });
      }

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await lockEstimateRequests(client, vor.estimateId);
        await client.query(
          `SELECT id FROM estimate_items
            WHERE id = ANY($1::uuid[]) AND estimate_id = $2::uuid
            ORDER BY id
              FOR UPDATE`,
          [itemIds, vor.estimateId],
        );

        // targetContractorId = null: при снятии «чужими» считаются все подрядчики строки,
        // включая снимаемого — иначе его собственная заявка не попала бы в защиту.
        const scope = await loadScopeRows(client, {
          estimateId: vor.estimateId,
          itemIds,
          targetContractorId: null,
        });
        const blocked = blockedForContractor(scope, contractorId.data);
        const blockedIds = new Set(blocked.map((b) => b.itemId));
        const clearableIds = itemIds.filter((id) => !blockedIds.has(id));

        if (clearableIds.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: 'По всем строкам этого подрядчика уже оформлены заявки на материалы — снять его нельзя',
            code: 'ASSIGNMENT_LOCKED_BY_REQUESTS',
          });
        }

        const { rows: removed } = await client.query(
          `DELETE FROM estimate_item_contractors
            WHERE item_id = ANY($1::uuid[]) AND contractor_id = $2::uuid
            RETURNING *`,
          [clearableIds, contractorId.data],
        );

        // Исполнителя сняли — его договорная цена на этих строках больше ничья.
        const clearedPrices = await clearStaleContractPrices(client, clearableIds);

        // Договорная запись уходит только если у подрядчика не осталось строк ВОР: при частичном
        // снятии (часть защищена заявками) реквизиты договора ещё нужны.
        await client.query(
          `DELETE FROM estimate_vor_contractors vc
            WHERE vc.vor_id = $1::uuid AND vc.contractor_id = $2::uuid
              AND NOT EXISTS (
                SELECT 1 FROM estimate_vor_items vi
                  JOIN estimate_item_contractors eic
                    ON eic.item_id = vi.item_id AND eic.contractor_id = vc.contractor_id
                 WHERE vi.vor_id = vc.vor_id)`,
          [vor.id, contractorId.data],
        );

        const auditInputs = removed.map((r) => ({
          estimateId: r.estimate_id as string,
          entityType: 'estimate_item_contractor',
          entityId: r.id as string,
          action: 'delete',
          userId,
          changes: { before: r, reason: 'vor_unassign', vorId: vor.id },
        }));
        for (let i = 0; i < auditInputs.length; i += 500) {
          await recordAuditBatch(client, auditInputs.slice(i, i + 500));
        }

        await client.query('COMMIT');

        if (removed.length > 0 || clearedPrices > 0) {
          const projectId = await loadProjectId(fastify.pool, vor.estimateId);
          await emitEstimateChanged(fastify, 'contractor_cleared', vor.estimateId, projectId, userId);
        }

        return reply.send({ data: { cleared: removed.length, blocked, clearedPrices } });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // POST /:id/vors/:vorId/prices?contractorId= — договорные цены из заполненного ВОР.
  //
  // Область — строки ВОР, где выбранный подрядчик единственный исполнитель: цены из его файла
  // не должны попадать на работы, которые делает кто-то другой. Файл проверяется ЦЕЛИКОМ до
  // первой записи: у каждой целевой работы и каждого её материала должна быть распознанная
  // цена, иначе смета осталась бы заполненной наполовину, и понять, чего не хватает, было бы
  // уже нельзя.
  fastify.post<{ Params: { id: string; vorId: string }; Querystring: { contractorId?: string } }>(
    '/:id/vors/:vorId/prices',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const resolved = await resolveVor(fastify, request);
      if ('error' in resolved)
        return reply.status(resolved.error.status).send({ error: resolved.error.message });
      const { vor } = resolved;
      const contractorId = z.string().uuid().safeParse(request.query.contractorId);
      if (!contractorId.success) return reply.status(400).send({ error: 'Не выбран подрядчик' });

      // Без построчного снимка сопоставить строки файла не с чем (ВОР до появления снимков).
      const manifest = await loadVorManifest(fastify, vor);
      if (!manifest) {
        return reply.status(409).send({
          error: 'У этого ВОР нет снимка строк — выгрузите ВОР заново и отправьте подрядчику новый файл',
          code: 'VOR_SNAPSHOT_UNAVAILABLE',
        });
      }

      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'Файл не загружен' });
      if (!file.filename.toLowerCase().endsWith('.xlsx'))
        return reply.status(400).send({ error: 'Только .xlsx файлы' });
      const buffer = await file.toBuffer();
      if (file.file.truncated) return reply.status(413).send({ error: 'Файл слишком большой' });

      let match;
      try {
        const parsed = parseFilledVorWorkbook(await loadWorkbook(buffer));
        if (parsed.vorId && parsed.vorId !== vor.id) {
          return reply.status(400).send({
            error: 'Файл выгружен из другого ВОР — загрузите тот файл, который отправляли этому подрядчику',
            code: 'VOR_FILE_MISMATCH',
          });
        }
        match = matchVorPrices(parsed, manifest);
      } catch (err) {
        if (err instanceof VorPriceParseError) return reply.status(400).send({ error: err.message });
        throw err;
      }

      // Целевые строки: этого ВОР и с единственным исполнителем — выбранным подрядчиком.
      const { rows: targetRows } = await fastify.pool.query(
        `SELECT vi.item_id
           FROM estimate_vor_items vi
           JOIN estimate_items ei ON ei.id = vi.item_id AND ei.estimate_id = $2
          WHERE vi.vor_id = $1
            AND (SELECT count(*) FROM estimate_item_contractors c WHERE c.item_id = vi.item_id) = 1
            AND EXISTS (SELECT 1 FROM estimate_item_contractors c
                         WHERE c.item_id = vi.item_id AND c.contractor_id = $3)`,
        [vor.id, vor.estimateId, contractorId.data],
      );
      const targetIds = new Set(targetRows.map((r) => r.item_id as string));
      if (targetIds.size === 0) {
        return reply.status(409).send({
          error: 'На этого подрядчика не назначено ни одной строки ВОР — сначала назначьте работы',
          code: 'VOR_NO_TARGET_ROWS',
        });
      }

      const works = match.works.filter((w) => targetIds.has(w.itemId));
      const materials = match.materials.filter((m) => targetIds.has(m.itemId));
      const skippedOtherContractor =
        match.works.length - works.length + (match.materials.length - materials.length);

      // Ожидаемый состав: строки, которые есть И в смете, И в снимке. Материал, добавленный
      // после выгрузки, в файле отсутствует — требовать на него цену нельзя; удалённый из
      // сметы — не нужен вовсе.
      const { rows: liveMaterials } = await fastify.pool.query(
        'SELECT id, item_id, description FROM estimate_materials WHERE item_id = ANY($1::uuid[])',
        [[...targetIds]],
      );
      const liveMaterialIds = new Set(liveMaterials.map((m) => m.id as string));
      const priceByWork = new Map(works.map((w) => [w.itemId, w]));
      const priceByMaterial = new Map(materials.map((m) => [m.materialId as string, m]));

      const issues: VorPriceIssue[] = [];
      for (const snap of manifest.items) {
        if (!targetIds.has(snap.itemId)) continue;
        const work = priceByWork.get(snap.itemId);
        if (!work || work.price === null) {
          issues.push(
            work
              ? toIssue(work, 'work')
              : { kind: 'work', number: null, name: snap.name, reason: 'not_matched' },
          );
        }
        for (const snapMat of snap.materials) {
          if (!liveMaterialIds.has(snapMat.materialId)) continue;
          const mat = priceByMaterial.get(snapMat.materialId);
          if (!mat || mat.price === null) {
            issues.push(
              mat
                ? toIssue(mat, 'material')
                : { kind: 'material', number: null, name: snapMat.name, reason: 'not_matched' },
            );
          }
        }
      }
      if (issues.length > 0) {
        return reply.status(409).send({
          error: 'В файле не хватает цен или часть строк не сопоставилась — смета не изменена',
          code: 'VOR_PRICES_INCOMPLETE',
          data: { issues: issues.slice(0, 20), total: issues.length },
        });
      }

      const userId = request.currentUser.id;
      const okWorks = works.filter((w) => w.price !== null);
      const okMaterials = materials.filter((m) => m.price !== null && liveMaterialIds.has(m.materialId!));

      const client = await fastify.pool.connect();
      let worksUpdated = 0;
      let materialsUpdated = 0;
      try {
        await client.query('BEGIN');
        if (okWorks.length > 0) {
          const res = await client.query(
            `UPDATE estimate_items ei
                SET contract_unit_price = t.price,
                    contract_price_vor_id = $3::uuid,
                    contract_price_contractor_id = $4::uuid,
                    contract_price_updated_at = now(),
                    contract_price_updated_by = $5::uuid
               FROM unnest($1::uuid[], $2::numeric[]) AS t(item_id, price)
              WHERE ei.id = t.item_id AND ei.estimate_id = $6::uuid
              RETURNING ei.id`,
            [
              okWorks.map((w) => w.itemId),
              okWorks.map((w) => w.price),
              vor.id,
              contractorId.data,
              userId,
              vor.estimateId,
            ],
          );
          worksUpdated = res.rowCount ?? 0;
        }
        if (okMaterials.length > 0) {
          // item_id = ANY(целевые) — материал обязан принадлежать работе этого подрядчика.
          const res = await client.query(
            `UPDATE estimate_materials em
                SET contract_unit_price = t.price,
                    contract_price_vor_id = $3::uuid,
                    contract_price_contractor_id = $4::uuid,
                    contract_price_updated_at = now(),
                    contract_price_updated_by = $5::uuid
               FROM unnest($1::uuid[], $2::numeric[]) AS t(material_id, price)
              WHERE em.id = t.material_id AND em.item_id = ANY($6::uuid[])
              RETURNING em.id`,
            [
              okMaterials.map((m) => m.materialId),
              okMaterials.map((m) => m.price),
              vor.id,
              contractorId.data,
              userId,
              [...targetIds],
            ],
          );
          materialsUpdated = res.rowCount ?? 0;
        }

        const auditInputs = okWorks.map((w) => ({
          estimateId: vor.estimateId,
          entityType: 'estimate_item',
          entityId: w.itemId,
          action: 'update',
          userId,
          changes: {
            after: { contract_unit_price: w.price, contract_price_contractor_id: contractorId.data },
            reason: 'vor_contract_prices',
            vorId: vor.id,
          },
        }));
        for (let i = 0; i < auditInputs.length; i += 500) {
          await recordAuditBatch(client, auditInputs.slice(i, i + 500));
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const projectId = await loadProjectId(fastify.pool, vor.estimateId);
      await emitEstimateChanged(fastify, 'contract_prices_applied', vor.estimateId, projectId, userId);

      // Журнал загрузок — уже после применения цен: присланный файл нужен при разборе споров о
      // цене, но недоступное хранилище не повод отменять успешно проставленные цены.
      let uploadId: string | null = null;
      try {
        const id = randomUUID();
        let fileKey: string | null = null;
        if (fastify.storage) {
          fileKey = `estimate-vors/${vor.estimateId}/prices/${id}.xlsx`;
          await fastify.storage.putObject(fileKey, buffer, XLSX_MIME);
        }
        const { rows } = await fastify.pool.query(
          `INSERT INTO estimate_vor_price_uploads
             (id, vor_id, estimate_id, contractor_id, file_key, file_name, file_size, checksum,
              works_updated, materials_updated, created_by, created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [
            id, vor.id, vor.estimateId, contractorId.data, fileKey, file.filename, buffer.length,
            createHash('sha256').update(buffer).digest('hex'), worksUpdated, materialsUpdated,
            userId, request.currentUser.fullName,
          ],
        );
        uploadId = (rows[0]?.id as string) ?? null;
      } catch (err) {
        fastify.log.warn({ err, vorId: vor.id }, 'vor price upload journaling failed');
      }

      return reply.send({
        data: { worksUpdated, materialsUpdated, skippedOtherContractor, uploadId },
      });
    },
  );
}
