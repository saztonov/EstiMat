// Перенос назначенного ответственного при завершении доработки заявки: строки
// material_request_items пересоздаются (DELETE+INSERT с новыми id), поэтому override
// ответственного сопоставляется со снимком по устойчивому ключу cost_type_id + agg_key +
// delivery_date. Совпал ключ — назначение переносится; изменённая/исчезнувшая позиция — нет.

export interface ResponsibleSnapshot {
  costTypeId: string | null;
  aggKey: string;
  /** YYYY-MM-DD либо null (позиция без графика поставки). */
  deliveryDate: string | null;
  userId: string;
  assignedBy: string | null;
  assignedAt: string | null;
}

export interface ItemKey {
  costTypeId: string | null;
  aggKey: string;
  deliveryDate: string | null;
}

export function carryOverKey(k: ItemKey): string {
  return [k.costTypeId ?? '', k.aggKey, k.deliveryDate ?? ''].join('|');
}

/**
 * Из снимка назначений оставить те, чей ключ присутствует среди новых (пересозданных) строк —
 * только их назначения переносятся.
 */
export function matchResponsibleCarryOver(
  snapshot: ResponsibleSnapshot[],
  newKeys: ItemKey[],
): ResponsibleSnapshot[] {
  const present = new Set(newKeys.map(carryOverKey));
  return snapshot.filter((s) => present.has(carryOverKey(s)));
}
