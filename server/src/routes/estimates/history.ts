import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';

// История изменений сметы (audit_log → человекочитаемая read-модель).
export function registerHistoryRoutes(fastify: FastifyInstance): void {
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
