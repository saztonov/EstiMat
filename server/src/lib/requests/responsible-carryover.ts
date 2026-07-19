// Перенос назначенных ответственных при завершении доработки заявки: строки
// material_request_items пересоздаются (DELETE+INSERT с новыми id), поэтому назначения
// сопоставляются со снимком по устойчивому ключу cost_type_id + agg_key + delivery_date.
// Совпал ключ — весь набор ответственных строки переносится; изменённая/исчезнувшая позиция — нет.
// Снимок берётся ПО СТРОКЕ (одна запись = одна исходная позиция с её массивом ответственных),
// а не по назначению — иначе несколько ответственных одной строки выглядели бы как конфликт ключа.

export interface ResponsibleAssignment {
  userId: string;
  assignedBy: string | null;
  assignedAt: string | null;
}

export interface ResponsibleSnapshot {
  costTypeId: string | null;
  aggKey: string;
  /** YYYY-MM-DD либо null (позиция без графика поставки). */
  deliveryDate: string | null;
  /** Все ответственные ОДНОЙ исходной строки. */
  responsibles: ResponsibleAssignment[];
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
 * Из снимка оставить строки, чей набор можно перенести ОДНОЗНАЧНО: ключ встречается ровно один
 * раз и среди исходных строк снимка, и среди новых строк. Так исключается over-application (перенос
 * на две строки с одинаковым ключом) и молчаливая перезапись (две исходные строки одного ключа) —
 * строки material_request_items по ключу (cost_type_id, agg_key, delivery_date) НЕ уникальны.
 * Счёт ведётся по СТРОКАМ (записям снимка), а не по числу ответственных внутри строки.
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
