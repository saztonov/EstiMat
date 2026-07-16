// Заказанное количество и цены материалов — из сводки /material-requests/ordered.
//
// Цена материала берётся ТОЛЬКО из оформленной закупки: сметный unit_price материала заполнен у
// единиц позиций, и показывать его как стоимость материалов нельзя. Пока материал не закупали,
// цены нет — это прочерк, а не ноль.
//
// Модуль чистый (без React и запросов) — считается в тестах.
import { lineKey } from '@estimat/shared';
import type { OrderMaterialRow } from './orderRow';

/** Строка сводки с сервера. priced_* отсутствуют, пока материал не закупали. */
export interface OrderedDto {
  cost_type_id: string | null;
  agg_key: string;
  ordered_qty: string | number | null;
  priced_qty?: string | number | null;
  priced_amount?: string | number | null;
}

const num = (v: string | number | null | undefined): number => Number(v ?? 0);

/**
 * Средневзвешенная цена по фактически закупленному количеству: один материал могли купить
 * несколькими закупками по разным ценам. Простое среднее исказило бы цену — 1000 шт по 10 ₽ и
 * 1 шт по 100 ₽ это не 55 ₽.
 */
export function weightedUnitPrice(
  amount: string | number | null | undefined,
  qty: string | number | null | undefined,
): number | null {
  const q = num(qty);
  const a = num(amount);
  if (!(q > 0)) return null;
  return a / q;
}

export interface OrderedMaps {
  /** orderKey → заказанное количество. */
  ordered: Map<string, number>;
  /** orderKey → цена из закупки (без НДС). Ключа нет — материал не закупали. */
  price: Map<string, number>;
}

export function buildOrderedMaps(rows: OrderedDto[]): OrderedMaps {
  const ordered = new Map<string, number>();
  const price = new Map<string, number>();
  for (const r of rows) {
    const key = lineKey(r.cost_type_id, r.agg_key);
    ordered.set(key, num(r.ordered_qty));
    const unit = weightedUnitPrice(r.priced_amount, r.priced_qty);
    if (unit != null) price.set(key, unit);
  }
  return { ordered, price };
}

/**
 * Подставить цены в строки свода. Делается ДО построения дерева: тогда таблица, узлы дерева и
 * карточки ИИ-групп считают суммы из одного источника, а инвариант «дерево = разбиение входа»
 * (assertTreeConserves) продолжает сходиться.
 */
export function applyOrderPrices(rows: OrderMaterialRow[], price: Map<string, number>): OrderMaterialRow[] {
  return rows.map((r) => {
    const unit = price.get(r.orderKey);
    if (unit == null) return r.orderUnitPrice == null ? r : { ...r, orderUnitPrice: null, materialCost: null };
    return { ...r, orderUnitPrice: unit, materialCost: unit * r.quantity };
  });
}
