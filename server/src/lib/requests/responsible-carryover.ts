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
 * Из снимка назначений оставить те, что можно перенести ОДНОЗНАЧНО: ключ встречается ровно один
 * раз и в снимке, и среди новых строк. Так исключается over-application (одно назначение на две
 * строки с одинаковым ключом) и молчаливая перезапись (два разных назначения на один ключ) —
 * строки material_request_items по ключу (cost_type_id, agg_key, delivery_date) НЕ уникальны.
 */
export function matchResponsibleCarryOver(
  snapshot: ResponsibleSnapshot[],
  newKeys: ItemKey[],
): ResponsibleSnapshot[] {
  const snapCount = new Map<string, number>();
  for (const s of snapshot) snapCount.set(carryOverKey(s), (snapCount.get(carryOverKey(s)) ?? 0) + 1);
  const newCount = new Map<string, number>();
  for (const k of newKeys) newCount.set(carryOverKey(k), (newCount.get(carryOverKey(k)) ?? 0) + 1);
  return snapshot.filter((s) => {
    const key = carryOverKey(s);
    return snapCount.get(key) === 1 && newCount.get(key) === 1;
  });
}
