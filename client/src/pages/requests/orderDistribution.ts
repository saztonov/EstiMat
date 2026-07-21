/**
 * Раскладка графика поставок обратно на позиции заявок.
 *
 * В окне заказа поставщику количество задаётся ГРАФИКОМ — по материалу (agg_key) и датам. А тело
 * запроса POST /supplier-orders состоит из позиций заявок (request_item_id), у каждой своя дата
 * поставки и свой остаток. Раньше эти две сущности вводились по отдельности: вкладка «Состав»
 * задавала количества по позициям, вкладка «График» — по датам, и совпадение их сумм лежало на
 * пользователе. Теперь ведущая сторона одна — график, а позиции выводятся из него здесь.
 *
 * Вынесено из модалки ради тестируемости (как соседний overplaced.ts): модалка тянет antd и
 * React, а проверять нужно чистую арифметику.
 *
 * ВСЯ арифметика — в целых десятитысячных (масштаб round4). Складывать float нельзя: сервер
 * сверяет сумму графика с суммой позиций с точностью 1e-6, и накопленная ошибка дала бы отказ
 * «Сумма графика не совпадает с количеством материала в заказе» на ровном месте.
 */
import type { OrderScheduleLine, OrderScheduleValue } from './orderSchedule';
import type { Su10MaterialRow } from './types';

const SCALE = 1e4;
/** Ввод пользователя и данные графика — округляем к ближайшему кванту. */
const toUnits = (v: number) => Math.round(v * SCALE);
/**
 * Ёмкость позиции — округляем ВНИЗ. Остаток приходит как requested − placed и может иметь больше
 * четырёх знаков; округление вверх дало бы запрос на 5e-5 больше настоящего остатка и 409.
 */
const floorUnits = (v: number) => Math.floor(v * SCALE + 1e-6);
const fromUnits = (u: number) => u / SCALE;

/** Позиции без даты сортируются последними: сначала расходуем то, у чего срок подтверждён. */
const NO_DATE = '9999-12-31';

/** Позиция заявки как источник объёма для заказа. */
export interface ItemCapacity {
  requestItemId: string;
  aggKey: string;
  date: string | null;
  /** Сколько ещё можно взять с этой позиции (в единицах масштаба). */
  capUnits: number;
  /**
   * Сколько этой позицией уже размещено В ЭТОМ ЖЕ заказе. UPSERT на сервере пишет количество
   * АБСОЛЮТНО, поэтому carry обязан войти в отправляемое значение — иначе повторный выбор той же
   * позиции не добавит объём, а затрёт ранее размещённый.
   */
  carryUnits: number;
}

export interface DistributedItem {
  requestItemId: string;
  quantity: number;
}

export interface DistributeResult {
  items: DistributedItem[];
  /** Что не удалось разложить: график больше суммарной ёмкости. При валидном вводе пусто. */
  unassigned: { aggKey: string; quantity: number }[];
}

/**
 * Ёмкости позиций из строк свода. carryByItemId — уже размещённое в редактируемом заказе:
 * оно и расширяет ёмкость (remaining его уже вычел), и переносится в итог.
 */
export function capacitiesOf(
  rows: Su10MaterialRow[],
  carryByItemId?: Map<string, number>,
): ItemCapacity[] {
  const out: ItemCapacity[] = [];
  for (const r of rows) {
    const carryUnits = floorUnits(carryByItemId?.get(r.request_item_id) ?? 0);
    const capUnits = floorUnits(r.remaining ?? 0);
    if (capUnits <= 0 && carryUnits <= 0) continue;
    out.push({
      requestItemId: r.request_item_id,
      aggKey: r.agg_key,
      date: r.delivery_date,
      capUnits,
      carryUnits,
    });
  }
  return out;
}

/**
 * Материалы графика: одна строка на agg_key, quantity — предельное количество к заказу.
 * base — то, что уже лежит в заказе по позициям, которых нет в payload: перезаписать их нельзя,
 * но сервер сверяет график по ВСЕМУ заказу, значит график обязан их покрывать.
 */
export function aggregateScheduleLines(
  rows: Su10MaterialRow[],
  caps: ItemCapacity[],
  baseByAggKey?: Map<string, number>,
): OrderScheduleLine[] {
  const capByKey = new Map<string, number>();
  for (const c of caps) {
    capByKey.set(c.aggKey, (capByKey.get(c.aggKey) ?? 0) + c.capUnits + c.carryUnits);
  }
  const out: OrderScheduleLine[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.agg_key) || !capByKey.has(r.agg_key)) continue;
    seen.add(r.agg_key);
    const base = floorUnits(baseByAggKey?.get(r.agg_key) ?? 0);
    out.push({
      aggKey: r.agg_key,
      name: r.material_name,
      unit: r.unit,
      quantity: fromUnits((capByKey.get(r.agg_key) ?? 0) + base),
    });
  }
  return out;
}

/**
 * Предзаполнение графика датами заявки, свёрнутыми по материалу.
 *
 * Позиции БЕЗ даты дают запись с deliveryDate: null — строку с пустым полем даты. Раньше они
 * молча выпадали: в прежнем режиме «сумма обязана совпасть» это ловилось ошибкой, а в режиме
 * «можно заказать меньше» недатированный остаток тихо потерялся бы.
 */
export function prefillFromRows(
  rows: Su10MaterialRow[],
  caps: ItemCapacity[],
): Record<string, { deliveryDate: string | null; quantity: number }[]> {
  const capById = new Map(caps.map((c) => [c.requestItemId, c]));
  const acc = new Map<string, Map<string | null, number>>();
  for (const r of rows) {
    const cap = capById.get(r.request_item_id);
    if (!cap) continue;
    // Только НОВЫЙ объём: carry уже отражён в существующем графике заказа, и сложение с ним
    // задвоило бы количество при дозаказе.
    const units = cap.capUnits;
    if (units <= 0) continue;
    const byDate = acc.get(r.agg_key) ?? new Map<string | null, number>();
    byDate.set(r.delivery_date, (byDate.get(r.delivery_date) ?? 0) + units);
    acc.set(r.agg_key, byDate);
  }
  const out: Record<string, { deliveryDate: string | null; quantity: number }[]> = {};
  for (const [key, byDate] of acc) {
    out[key] = [...byDate.entries()]
      .sort((a, b) => (a[0] ?? NO_DATE).localeCompare(b[0] ?? NO_DATE))
      .map(([deliveryDate, units]) => ({ deliveryDate, quantity: fromUnits(units) }));
  }
  return out;
}

/**
 * Слить предзаполнение с уже сохранённым графиком заказа (режим дозаказа): существующие даты
 * остаются, новый объём добавляется к своей дате или отдельной строкой.
 */
export function mergeSchedulePrefill(
  base: Record<string, { deliveryDate: string | null; quantity: number }[]>,
  extra: Record<string, { deliveryDate: string | null; quantity: number }[]>,
): Record<string, { deliveryDate: string | null; quantity: number }[]> {
  const acc = new Map<string, Map<string | null, number>>();
  for (const src of [base, extra]) {
    for (const [key, entries] of Object.entries(src)) {
      const byDate = acc.get(key) ?? new Map<string | null, number>();
      for (const e of entries) {
        byDate.set(e.deliveryDate, (byDate.get(e.deliveryDate) ?? 0) + toUnits(e.quantity));
      }
      acc.set(key, byDate);
    }
  }
  const out: Record<string, { deliveryDate: string | null; quantity: number }[]> = {};
  for (const [key, byDate] of acc) {
    out[key] = [...byDate.entries()]
      .sort((a, b) => (a[0] ?? NO_DATE).localeCompare(b[0] ?? NO_DATE))
      .map(([deliveryDate, units]) => ({ deliveryDate, quantity: fromUnits(units) }));
  }
  return out;
}

/**
 * Квантование графика перед отправкой: на сервер уходят ровно те числа, из которых считались
 * позиции. Без этого доля меньше кванта попала бы в график, но не в позиции, и суммы разошлись бы.
 */
export function normalizeSchedule(value: OrderScheduleValue[]): OrderScheduleValue[] {
  return value
    .map((l) => ({
      aggKey: l.aggKey,
      entries: l.entries
        .map((e) => ({ deliveryDate: e.deliveryDate, quantity: fromUnits(toUnits(e.quantity)) }))
        .filter((e) => e.quantity > 0),
    }))
    .filter((l) => l.entries.length > 0);
}

/**
 * Разложить график по позициям заявок.
 *
 * Два прохода: сначала записи графика забирают объём с позиций С ТОЙ ЖЕ датой (заказ остаётся
 * привязан к срокам заявки), затем неразобранный хвост раздаётся жадно по возрастанию даты.
 * Порядок пула детерминирован, поэтому результат воспроизводим.
 */
export function distributeToRequestItems(
  caps: ItemCapacity[],
  schedule: OrderScheduleValue[],
  baseByAggKey?: Map<string, number>,
): DistributeResult {
  const pools = new Map<string, (ItemCapacity & { allocUnits: number })[]>();
  for (const c of caps) {
    const pool = pools.get(c.aggKey) ?? [];
    pool.push({ ...c, allocUnits: 0 });
    pools.set(c.aggKey, pool);
  }
  for (const pool of pools.values()) {
    pool.sort((a, b) =>
      (a.date ?? NO_DATE).localeCompare(b.date ?? NO_DATE) || a.requestItemId.localeCompare(b.requestItemId));
  }

  const unassigned: DistributeResult['unassigned'] = [];

  for (const line of schedule) {
    const pool = pools.get(line.aggKey);
    const base = floorUnits(baseByAggKey?.get(line.aggKey) ?? 0);
    // Бюджет к раздаче — сумма графика за вычетом того, что уже лежит в заказе чужими позициями.
    let restUnits = line.entries.reduce((s, e) => s + toUnits(e.quantity), 0) - base;
    if (!pool || restUnits <= 0) {
      if (restUnits > 0) unassigned.push({ aggKey: line.aggKey, quantity: fromUnits(restUnits) });
      continue;
    }

    // Проход 1 — точное совпадение даты. Цикл по ВСЕМУ пулу, а не поиск одной позиции: на одну
    // дату у материала бывает несколько позиций (разные заявки и подрядчики).
    const entries = [...line.entries].sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    for (const e of entries) {
      let need = Math.min(toUnits(e.quantity), restUnits);
      for (const p of pool) {
        if (need <= 0) break;
        if (p.date !== e.deliveryDate) continue;
        const take = Math.min(need, p.capUnits - p.allocUnits);
        if (take <= 0) continue;
        p.allocUnits += take;
        need -= take;
        restUnits -= take;
      }
    }

    // Проход 2 — хвост жадно по пулу (ближайшие даты первыми, недатированные последними).
    for (const p of pool) {
      if (restUnits <= 0) break;
      const take = Math.min(restUnits, p.capUnits - p.allocUnits);
      if (take <= 0) continue;
      p.allocUnits += take;
      restUnits -= take;
    }
    if (restUnits > 0) unassigned.push({ aggKey: line.aggKey, quantity: fromUnits(restUnits) });
  }

  // Позиция с carry, но без нового объёма тоже отправляется: абсолютный UPSERT иначе оставит в
  // заказе прежнее количество, и график перестанет сходиться с составом.
  const items: DistributedItem[] = [];
  for (const pool of pools.values()) {
    for (const p of pool) {
      const total = p.allocUnits + p.carryUnits;
      if (total > 0) items.push({ requestItemId: p.requestItemId, quantity: fromUnits(total) });
    }
  }
  return { items, unassigned };
}
