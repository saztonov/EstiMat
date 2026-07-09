/**
 * Движок отмены действий в смете (undo) поверх журнала audit_log.
 *
 * Единица отмены — correlation-группа: все записи одного жеста пользователя (работа +
 * её каскадные/пересчитанные материалы; для массового удаления — все удалённые строки),
 * помеченные changes.undoable=true. Инверсия по типу операции:
 *   *_create → удалить созданное; *_update → восстановить before; *_delete/bulk_delete → повторно вставить снимок.
 * Производные значения (total_amount, project_id, version) поддерживают триггеры БД —
 * undo делает обычные INSERT/UPDATE/DELETE. total — GENERATED, в INSERT не участвует.
 *
 * Отмена — только последних действий текущего пользователя, не глубже UNDO_MAX_DEPTH.
 * Конфликты (строку изменил/удалил другой пользователь) блокируют отмену целиком (409).
 */
import { randomUUID } from 'node:crypto';
import type { UndoOperationKind } from '@estimat/shared';

// Глубина стека: отменяются только 50 последних undoable-групп пользователя в смете.
export const UNDO_MAX_DEPTH = 50;

// Минимальный интерфейс БД — совместим с pg.PoolClient (как в lib/audit.ts).
interface Db {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

// Ошибка отмены с HTTP-статусом и кодом (совместимо с обработкой ApiError на клиенте).
export class UndoError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'UndoError';
  }
}

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: Record<string, unknown>;
}

export interface UndoTargetInfo {
  correlationId: string;
  operationKind: UndoOperationKind;
  summary: string;
}

// Колонка jsonb для реинсерта снимков (нужен ::jsonb-каст и JSON.stringify).
const ITEM_JSONB_COLS = new Set(['locations']);
const MATERIAL_JSONB_COLS = new Set<string>();
// GENERATED-колонка — никогда не пишется руками.
const GENERATED_COLS = new Set(['total']);

// Разрешённые для восстановления колонки (имена приходят из наших же audit-записей,
// но фильтруем явно — защита от подстановки произвольного имени в SQL).
const ITEM_UPDATE_COLS = new Set([
  'cost_type_id', 'rate_id', 'description', 'quantity', 'unit', 'unit_price', 'sort_order',
  'locations', 'zone_id', 'floor_from', 'floor_to', 'room_type_id', 'needs_review',
  'location_type_id', 'volume_type',
]);
const MATERIAL_UPDATE_COLS = new Set([
  'material_id', 'description', 'unit', 'unit_price', 'sort_order', 'status', 'needs_review',
  'qty_ratio', 'quantity',
]);

// ── Публичный API ───────────────────────────────────────────────────────────

// Что отменится следующим (для кнопки/подсказки). Только чтение.
export async function peekUndo(db: Db, estimateId: string, userId: string): Promise<UndoTargetInfo | null> {
  const correlationId = await findUndoCorrelationId(db, estimateId, userId);
  if (!correlationId) return null;
  const group = await loadGroup(db, estimateId, correlationId);
  if (group.length === 0) return null;
  const { operationKind, summary } = await describeGroup(db, group);
  return { correlationId, operationKind, summary };
}

// Выполнить отмену. Вызывается внутри транзакции роута (BEGIN уже открыт).
// Бросает UndoError (empty/conflict) — роут делает ROLLBACK и мапит статус.
export async function performUndo(
  db: Db,
  estimateId: string,
  userId: string,
): Promise<UndoTargetInfo & { projectId: string | null }> {
  // Сериализация параллельных undo одной сметы + проверка существования.
  const est = await db.query('SELECT project_id FROM estimates WHERE id = $1 FOR UPDATE', [estimateId]);
  if (est.rows.length === 0) throw new UndoError('Смета не найдена', 404, 'NOT_FOUND');
  const projectId = (est.rows[0]?.project_id as string | null) ?? null;

  const correlationId = await findUndoCorrelationId(db, estimateId, userId);
  if (!correlationId) throw new UndoError('Нет действий для отмены', 409, 'UNDO_EMPTY');

  const group = await loadGroup(db, estimateId, correlationId);
  if (group.length === 0) throw new UndoError('Нет действий для отмены', 409, 'UNDO_EMPTY');

  // Сводку строим до инверсии (для update нужен ещё существующий description).
  const { operationKind, summary } = await describeGroup(db, group);

  await reverseGroup(db, group, userId);

  // Помечаем всю группу отменённой — следующее нажатие возьмёт предыдущее действие.
  await db.query(
    `UPDATE audit_log SET undone_at = now(), undone_by = $3
       WHERE estimate_id = $1 AND correlation_id = $2 AND origin = 'user'`,
    [estimateId, correlationId, userId],
  );

  // Сводная запись отмены (origin='undo' — в стек не попадает, но видна в «Истории»).
  await db.query(
    `INSERT INTO audit_log
       (id, entity_type, entity_id, action, user_id, changes, estimate_id, project_id, correlation_id, origin, undo_of)
     VALUES ($1, 'estimate', $2, 'undo', $3, $4, $2, $5, $6, 'undo', $7)`,
    [randomUUID(), estimateId, userId, JSON.stringify({ summary, operationKind }), projectId, randomUUID(), correlationId],
  );

  return { correlationId, operationKind, summary, projectId };
}

// ── Внутреннее ──────────────────────────────────────────────────────────────

// Последняя активная своя undoable-группа в пределах последних UNDO_MAX_DEPTH групп.
async function findUndoCorrelationId(db: Db, estimateId: string, userId: string): Promise<string | null> {
  const { rows } = await db.query(
    `WITH groups AS (
       SELECT correlation_id,
              MAX(created_at) AS ts,
              BOOL_OR(undone_at IS NOT NULL) AS undone
       FROM audit_log
       WHERE estimate_id = $1 AND user_id = $2 AND origin = 'user'
         AND (changes->>'undoable') = 'true' AND correlation_id IS NOT NULL
       GROUP BY correlation_id
     ),
     recent AS (SELECT * FROM groups ORDER BY ts DESC LIMIT ${UNDO_MAX_DEPTH})
     SELECT correlation_id FROM recent WHERE NOT undone ORDER BY ts DESC LIMIT 1`,
    [estimateId, userId],
  );
  return (rows[0]?.correlation_id as string | undefined) ?? null;
}

async function loadGroup(db: Db, estimateId: string, correlationId: string): Promise<AuditRow[]> {
  const { rows } = await db.query(
    `SELECT id, entity_type, entity_id, action, changes
       FROM audit_log
      WHERE estimate_id = $1 AND correlation_id = $2 AND origin = 'user' AND (changes->>'undoable') = 'true'
      ORDER BY created_at, id`,
    [estimateId, correlationId],
  );
  return rows as unknown as AuditRow[];
}

function snapshotDescription(row: AuditRow | undefined): string | null {
  if (!row) return null;
  const after = row.changes?.after as Record<string, unknown> | undefined;
  const before = row.changes?.before as Record<string, unknown> | undefined;
  const d = (after?.description ?? before?.description) as string | undefined;
  return d ?? null;
}

async function fetchDescription(db: Db, table: 'estimate_items' | 'estimate_materials', id: string | undefined): Promise<string | null> {
  if (!id) return null;
  const { rows } = await db.query(`SELECT description FROM ${table} WHERE id = $1`, [id]);
  return (rows[0]?.description as string | undefined) ?? null;
}

// Русская форма числительного.
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

async function describeGroup(db: Db, group: AuditRow[]): Promise<{ operationKind: UndoOperationKind; summary: string }> {
  const kind = (group[0]?.changes?.operationKind ?? 'item_update') as UndoOperationKind;
  const items = group.filter((r) => r.entity_type === 'estimate_item');
  const materials = group.filter((r) => r.entity_type === 'estimate_material');
  const matWord = (n: number) => plural(n, ['материал', 'материала', 'материалов']);
  const matSuffix = materials.length ? ` и ${materials.length} ${matWord(materials.length)}` : '';

  switch (kind) {
    case 'item_create':
      return { operationKind: kind, summary: `Добавление работы «${snapshotDescription(items[0]) ?? '—'}»${matSuffix}` };
    case 'item_delete':
      return { operationKind: kind, summary: `Удаление работы «${snapshotDescription(items[0]) ?? '—'}»${matSuffix}` };
    case 'item_update':
      return { operationKind: kind, summary: `Изменение работы «${(await fetchDescription(db, 'estimate_items', items[0]?.entity_id)) ?? '—'}»` };
    case 'material_create':
      return { operationKind: kind, summary: `Добавление материала «${snapshotDescription(materials[0]) ?? '—'}»` };
    case 'material_delete':
      return { operationKind: kind, summary: `Удаление материала «${snapshotDescription(materials[0]) ?? '—'}»` };
    case 'material_update':
      return { operationKind: kind, summary: `Изменение материала «${(await fetchDescription(db, 'estimate_materials', materials[0]?.entity_id)) ?? '—'}»` };
    case 'bulk_delete': {
      const standalone = materials.filter((m) => (m.changes?.reason as string | undefined) !== 'cascade');
      const n = items.length + standalone.length;
      return { operationKind: kind, summary: `Удаление строк: ${n}` };
    }
    default:
      return { operationKind: kind, summary: 'Отмена действия' };
  }
}

async function reverseGroup(db: Db, group: AuditRow[], userId: string): Promise<void> {
  const kind = (group[0]?.changes?.operationKind ?? 'item_update') as UndoOperationKind;
  const items = group.filter((r) => r.entity_type === 'estimate_item');
  const materials = group.filter((r) => r.entity_type === 'estimate_material');

  if (kind === 'item_create' || kind === 'material_create') {
    // Инверсия create — удалить созданное. Сначала проверяем, что удаление не заденет чужого.
    if (kind === 'item_create') await assertCreateItemsReversible(db, items, materials);
    else await assertCreateMaterialsReversible(db, materials);
    for (const m of materials) await db.query('DELETE FROM estimate_materials WHERE id = $1', [m.entity_id]);
    for (const it of items) await db.query('DELETE FROM estimate_items WHERE id = $1', [it.entity_id]);
    return;
  }

  if (kind === 'item_update' || kind === 'material_update') {
    for (const r of group) await restoreBefore(db, r, userId);
    return;
  }

  if (kind === 'item_delete' || kind === 'material_delete' || kind === 'bulk_delete') {
    // Инверсия delete — вернуть снимки. Сначала работы (FK материалов ссылается на них), затем материалы.
    for (const it of items) await insertFromSnapshot(db, 'estimate_items', it, ITEM_JSONB_COLS, 'Работа');
    for (const m of materials) await insertFromSnapshot(db, 'estimate_materials', m, MATERIAL_JSONB_COLS, 'Материал');
    return;
  }

  throw new UndoError('Неизвестный тип операции для отмены', 409, 'UNDO_CONFLICT');
}

// Проверка: работу можно удалить в рамках отмены её создания.
async function assertCreateItemsReversible(db: Db, items: AuditRow[], materials: AuditRow[]): Promise<void> {
  const origMatIds = materials.map((m) => m.entity_id);
  for (const it of items) {
    const cur = await db.query('SELECT version FROM estimate_items WHERE id = $1 FOR UPDATE', [it.entity_id]);
    if (cur.rows.length === 0) continue; // уже удалена — удалять нечего
    const expected = Number((it.changes?.after as Record<string, unknown> | undefined)?.version);
    if (Number.isFinite(expected) && Number(cur.rows[0]?.version) !== expected) {
      throw new UndoError('Работу изменил другой пользователь — отмена невозможна', 409, 'UNDO_CONFLICT');
    }
    // Появившиеся после создания «чужие» материалы → каскад удалил бы их, блокируем.
    const foreign = await db.query(
      'SELECT 1 FROM estimate_materials WHERE item_id = $1 AND id <> ALL($2::uuid[]) LIMIT 1',
      [it.entity_id, origMatIds],
    );
    if (foreign.rows.length > 0) {
      throw new UndoError('К работе добавлены новые материалы — отмену создания выполнить нельзя', 409, 'UNDO_CONFLICT');
    }
  }
}

async function assertCreateMaterialsReversible(db: Db, materials: AuditRow[]): Promise<void> {
  for (const m of materials) {
    const cur = await db.query('SELECT version FROM estimate_materials WHERE id = $1 FOR UPDATE', [m.entity_id]);
    if (cur.rows.length === 0) continue;
    const expected = Number((m.changes?.after as Record<string, unknown> | undefined)?.version);
    if (Number.isFinite(expected) && Number(cur.rows[0]?.version) !== expected) {
      throw new UndoError('Материал изменил другой пользователь — отмена невозможна', 409, 'UNDO_CONFLICT');
    }
  }
}

// Восстановление before по changedFields (для update/confirm).
async function restoreBefore(db: Db, row: AuditRow, userId: string): Promise<void> {
  const table = row.entity_type === 'estimate_item' ? 'estimate_items' : 'estimate_materials';
  const allowed = table === 'estimate_items' ? ITEM_UPDATE_COLS : MATERIAL_UPDATE_COLS;
  const before = (row.changes?.before as Record<string, unknown> | undefined) ?? {};
  const changedFields = (row.changes?.changedFields as string[] | undefined) ?? Object.keys(before);
  const expected = Number(row.changes?.afterVersion);

  const cur = await db.query(`SELECT version FROM ${table} WHERE id = $1 FOR UPDATE`, [row.entity_id]);
  if (cur.rows.length === 0) throw new UndoError('Строка уже удалена — отмена изменения невозможна', 409, 'UNDO_CONFLICT');
  if (Number.isFinite(expected) && Number(cur.rows[0]?.version) !== expected) {
    throw new UndoError('Строку изменил другой пользователь — отмена невозможна', 409, 'UNDO_CONFLICT');
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const f of changedFields) {
    if (!allowed.has(f) || !(f in before)) continue;
    if (f === 'locations') {
      sets.push(`locations = $${i++}::jsonb`);
      values.push(JSON.stringify(before[f] ?? []));
    } else {
      sets.push(`${f} = $${i++}`);
      values.push(before[f] ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push(`updated_by = $${i++}`);
  values.push(userId);
  values.push(row.entity_id);
  await db.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

// Повторная вставка строки из полного before-снимка с тем же id (для delete/bulk_delete).
// Список колонок берём из ключей снимка (SELECT * → точное соответствие схеме), исключая GENERATED.
async function insertFromSnapshot(
  db: Db,
  table: 'estimate_items' | 'estimate_materials',
  row: AuditRow,
  jsonbCols: Set<string>,
  label: string,
): Promise<void> {
  const before = (row.changes?.before as Record<string, unknown> | undefined) ?? {};
  const exists = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [row.entity_id]);
  if (exists.rows.length > 0) {
    throw new UndoError(`${label} уже восстановлена или существует — отмена невозможна`, 409, 'UNDO_CONFLICT');
  }
  const cols = Object.keys(before).filter((c) => !GENERATED_COLS.has(c));
  if (cols.length === 0) throw new UndoError(`Не удалось восстановить: пустой снимок`, 409, 'UNDO_CONFLICT');
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const placeholders = cols.map((c, idx) => (jsonbCols.has(c) ? `$${idx + 1}::jsonb` : `$${idx + 1}`)).join(', ');
  const values = cols.map((c) => (jsonbCols.has(c) ? JSON.stringify(before[c] ?? null) : before[c] ?? null));
  try {
    await db.query(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`, values);
  } catch {
    throw new UndoError(`Не удалось восстановить: ${label.toLowerCase()} (конфликт данных)`, 409, 'UNDO_CONFLICT');
  }
}
