/**
 * Единственный владелец денежной формулы заказа поставщику.
 *
 * Сумма считается в ДВУХ разных сценариях: при оформлении победителя (цены вводит инженер) и при
 * правке состава уже присуждённого заказа (цены не меняются, меняется количество). Формула обязана
 * быть одна: две её копии разошлись бы на округлении, и расхождение с счётом поставщика стало бы
 * неотличимо от ошибки распознавания.
 *
 * Арифметика — в SQL numeric, не через JS Number: построчно net = ROUND(кол-во × цена, 2),
 * НДС = ROUND(net × ставка, 2), итог = Σ(net + НДС). Порядок округления повторяет тот, по которому
 * поставщики выставляют счета, и менять его нельзя — сумма перестанет сходиться с документом.
 */
import type { PoolClient } from 'pg';
import { MANUAL_VAT_RATE_VALUE, type ManualVatRate } from '@estimat/shared';

export interface OrderAmountResult {
  /** Итог с НДС, decimal-строкой (numeric(15,2)). */
  amount: string;
  /**
   * Агрегаты заказа, у которых нет цены. Непустой список означает, что сумму считать не по чему:
   * молча подставленный ноль занизил бы заказ, поэтому решение принимает вызывающий.
   */
  missingPrices: string[];
}

/**
 * Пересчитать сумму заказа по текущему составу и сохранённым ценам.
 * Вызывать внутри транзакции, после того как состав и цены уже записаны.
 */
export async function recalcOrderAmount(
  client: PoolClient,
  orderId: string,
  vatRate: ManualVatRate,
): Promise<OrderAmountResult> {
  const rate = MANUAL_VAT_RATE_VALUE[vatRate];

  // Агрегаты без цены ищем отдельным запросом, а не по NULL в сумме: LEFT JOIN с COALESCE(price,0)
  // дал бы «валидную» заниженную сумму, и ошибка ушла бы в согласование незамеченной.
  const { rows: missing } = await client.query(
    `SELECT DISTINCT i.agg_key
       FROM supplier_order_items i
       LEFT JOIN supplier_order_price_lines pl ON pl.order_id = i.order_id AND pl.agg_key = i.agg_key
      WHERE i.order_id = $1 AND pl.agg_key IS NULL`,
    [orderId],
  );
  const missingPrices = missing.map((r) => r.agg_key as string);

  const { rows } = await client.query(
    `WITH agg AS (
       SELECT agg_key, SUM(quantity) AS qty FROM supplier_order_items WHERE order_id = $1 GROUP BY agg_key
     ), line AS (
       SELECT ROUND(a.qty * pl.unit_price, 2) AS net
         FROM agg a JOIN supplier_order_price_lines pl ON pl.order_id = $1 AND pl.agg_key = a.agg_key
     )
     SELECT COALESCE(SUM(net + ROUND(net * $2::numeric, 2)), 0)::numeric(15,2) AS total FROM line`,
    [orderId, rate],
  );

  return { amount: String(rows[0].total), missingPrices };
}
