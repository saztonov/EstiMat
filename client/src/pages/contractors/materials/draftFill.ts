// Набор заявки: черновик количеств и массовое заполнение по группе.
//
// Черновик живёт по ключу заказа (orderKey), а не по позиции в дереве — поэтому переживает
// перестройку дерева, смену уровней и общий для стандартного и умного режима. Дерево про черновик
// не знает и знать не должно: массовое заполнение получает уже готовый список строк.
//
// Две инварианта, на которых держится безопасность массового действия:
//   1. Присваивание, а не накопление. Повторный клик по группе не удваивает заказ: 100% → 50%
//      даёт 50%, а не 150%. В сценарии «один клик = 40 строк с деньгами» накопление — это класс
//      ошибок, который нельзя ловить внимательностью.
//   2. Ручной ввод не затирается. Строка, где количество ввели руками, помечается manual и
//      массовыми действиями не меняется (пока пользователь явно не выберет «Заменить ручные»).
import type { OrderMaterialRow } from './orderRow';
import { remainingOf } from './remaining';
import type { MaterialTreeNode } from './materialTree';
import { flattenTreeRows } from './materialTree';

/** Точность количеств — та же, что в «Кол-во по смете» и в хэше входа группировки. */
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

export interface DraftState {
  /** orderKey → количество в заявке. Ключа нет = строка не в заявке (значение > 0 всегда). */
  values: Map<string, number>;
  /** orderKey строк, где количество введено вручную: массовые действия их не трогают. */
  manual: Set<string>;
}

export const emptyDraft = (): DraftState => ({ values: new Map(), manual: new Set() });

/** Итог массового действия — для тоста: пользователь должен видеть, что именно произошло. */
export interface FillOutcome {
  next: DraftState;
  /** Строк добавлено в заявку (раньше их там не было). */
  added: number;
  /** Строк обновлено (значение было и изменилось). */
  updated: number;
  /** Ручных строк сохранено — их массовое действие не тронуло. */
  manualKept: number;
  /** Строк пропущено: остатка нет (всё уже заявлено). */
  noRemainder: number;
}

/** Остаток по строке с учётом уже заявленного. */
export function availableOf(row: OrderMaterialRow, ordered: Map<string, number>): number {
  return remainingOf(row.quantity, ordered.get(row.orderKey) ?? 0);
}

/**
 * Заполнить черновик долей остатка по набору строк.
 *
 * База — остаток (кол-во по смете − уже заявлено), а не полный объём: «100%» значит «всё, что ещё
 * не заявлено». Поэтому повторный «100%» по уже заявленной группе даёт 0 — строки просто выпадают
 * из черновика, и двойного заказа не выходит.
 *
 * @param percent доля остатка в процентах, (0, 100]
 * @param replaceManual заменить и вручную введённые значения тоже
 */
export function fillDraft(
  draft: DraftState,
  rows: OrderMaterialRow[],
  ordered: Map<string, number>,
  percent: number,
  replaceManual = false,
): FillOutcome {
  const values = new Map(draft.values);
  const manual = new Set(draft.manual);
  let added = 0;
  let updated = 0;
  let manualKept = 0;
  let noRemainder = 0;

  for (const row of rows) {
    const key = row.orderKey;
    if (!replaceManual && manual.has(key)) {
      manualKept++;
      continue;
    }
    const available = availableOf(row, ordered);
    if (available <= 0) {
      noRemainder++;
      continue;
    }
    // При 100% берём остаток напрямую: умножение на 1.0 дало бы лишний дрейф в последнем знаке.
    const value = percent === 100 ? round4(available) : round4((available * percent) / 100);
    const had = values.get(key);
    if (value <= 0) {
      if (had != null) values.delete(key);
      noRemainder++;
      continue;
    }
    if (had == null) added++;
    else if (had !== value) updated++;
    values.set(key, value);
    // Значение стало расчётным — ручная пометка снимается.
    if (replaceManual) manual.delete(key);
  }

  return { next: { values, manual }, added, updated, manualKept, noRemainder };
}

/** Убрать строки набора из черновика (кнопка «убрать группу из заявки»). */
export function clearDraftFor(draft: DraftState, rows: OrderMaterialRow[]): DraftState {
  const values = new Map(draft.values);
  const manual = new Set(draft.manual);
  for (const row of rows) {
    values.delete(row.orderKey);
    manual.delete(row.orderKey);
  }
  return { values, manual };
}

/** Построчная правка. v ≤ 0 убирает строку из заявки; ввод помечает строку ручной. */
export function setDraftValue(draft: DraftState, orderKey: string, v: number | null): DraftState {
  const values = new Map(draft.values);
  const manual = new Set(draft.manual);
  if (v == null || v <= 0) {
    values.delete(orderKey);
    manual.delete(orderKey);
  } else {
    values.set(orderKey, round4(v));
    manual.add(orderKey);
  }
  return { values, manual };
}

export interface DraftStats {
  /** Позиций в заявке. */
  count: number;
  /** Оценка суммы по строкам, у которых есть цена закупки. */
  money: number;
  /** Из них с ценой — «оценено N из M». */
  pricedCount: number;
}

/**
 * Сводка черновика.
 *
 * Деньги считаются от количества в черновике, а НЕ от row.materialCost: последний — это
 * orderUnitPrice × кол-во по смете, то есть стоимость всего сметного объёма, а не заявляемого.
 */
export function draftStats(rows: OrderMaterialRow[], draft: DraftState): DraftStats {
  let count = 0;
  let money = 0;
  let pricedCount = 0;
  for (const row of rows) {
    const v = draft.values.get(row.orderKey);
    if (v == null) continue;
    count++;
    if (row.orderUnitPrice != null) {
      money += v * row.orderUnitPrice;
      pricedCount++;
    }
  }
  return { count, money, pricedCount };
}

/**
 * Сколько строк каждого узла дерева уже в заявке: один обход вместо пересчёта на каждом узле
 * (на 577 строках наивный подсчёт по узлу — это O(узлы × строки) на каждое нажатие).
 */
export function buildDraftIndex(nodes: MaterialTreeNode[], draft: DraftState): Map<string, number> {
  const index = new Map<string, number>();
  const walk = (list: MaterialTreeNode[]): number => {
    let total = 0;
    for (const node of list) {
      let own = 0;
      for (const m of node.materials) if (draft.values.has(m.orderKey)) own++;
      own += walk(node.children);
      index.set(node.key, own);
      total += own;
    }
    return total;
  };
  walk(nodes);
  return index;
}

/** Все строки поддерева узла — область массового действия в стандартной группировке. */
export function subtreeRows(node: MaterialTreeNode): OrderMaterialRow[] {
  return flattenTreeRows([node]);
}
