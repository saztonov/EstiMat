import type { AuditLogEntry } from '@estimat/shared';

// Подписи действий аудита (используются в ленте истории и в инфо-поповере строки).
export const ACTION_LABEL: Record<string, string> = {
  create: 'добавил(а)',
  update: 'изменил(а)',
  delete: 'удалил(а)',
  reassign: 'перенёс(ла)',
  confirm: 'согласовал(а)',
  ai_apply: 'применил(а) ИИ',
  undo: 'отменил(а)',
};

export const ENTITY_LABEL: Record<string, string> = {
  estimate: 'смету',
  estimate_item: 'работу',
  estimate_material: 'материал',
  estimate_contractor: 'подрядчика',
  estimate_item_contractor: 'исполнителя строки',
};

export const ACTION_COLOR: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  reassign: 'gold',
  confirm: 'cyan',
  ai_apply: 'purple',
  undo: 'volcano',
};

// Подписи полей — только для фолбэка (старые/неизвестные записи без серверного changesView).
export const FIELD_LABEL: Record<string, string> = {
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
  work_type: 'вид работ',
  notes: 'примечания',
};

export function entityName(e: AuditLogEntry): string | null {
  const after = (e.changes?.after ?? null) as Record<string, unknown> | null;
  const before = (e.changes?.before ?? null) as Record<string, unknown> | null;
  const d = (after?.description ?? before?.description) as string | undefined;
  return d ?? null;
}

export function describe(e: AuditLogEntry): string {
  const who = e.userName ?? 'Система';
  const act = ACTION_LABEL[e.action] ?? e.action;
  if (e.action === 'ai_apply') {
    const w = Number(e.changes?.works ?? 0);
    const m = Number(e.changes?.materials ?? 0);
    return `${who} применил(а) ИИ: работ ${w}, материалов ${m}`;
  }
  if (e.action === 'undo') {
    const summary = (e.changes as { summary?: string } | null)?.summary;
    return summary ? `${who} отменил(а): ${summary}` : `${who} отменил(а) действие`;
  }
  const ent = ENTITY_LABEL[e.entityType] ?? e.entityType;
  const name = entityName(e);
  return `${who} ${act} ${ent}${name ? `: ${name}` : ''}`;
}

// Значение для фолбэка: избегаем «[object Object]» для jsonb/массивов.
export function fallbackValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return '…';
  return String(v);
}

// Изменённые поля «подпись: старое → новое». Предпочитаем серверный changesView
// (UUID уже резолвлены в имена, locations отформатирован); иначе — сырой фолбэк.
export function changedRows(e: AuditLogEntry): { label: string; before: string; after: string }[] {
  if (e.changesView && e.changesView.length > 0) {
    return e.changesView.map((c) => ({ label: c.label, before: c.before ?? '—', after: c.after ?? '—' }));
  }
  const fields = e.changes?.changedFields;
  if (!Array.isArray(fields) || e.action !== 'update') return [];
  const before = (e.changes?.before ?? {}) as Record<string, unknown>;
  const after = (e.changes?.after ?? {}) as Record<string, unknown>;
  return fields.map((f) => ({ label: FIELD_LABEL[f] ?? f, before: fallbackValue(before[f]), after: fallbackValue(after[f]) }));
}
