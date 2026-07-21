/**
 * График поставки заказа (supplier_order_delivery_schedule), ключ — agg_key агрегата материала.
 *
 * Правило одно и то же в обоих местах, где график принимается от снабжения (создание заказа и
 * правка графика), и до выделения оно было продублировано дословно. Инвариант: сумма по датам
 * каждого agg_key равна количеству этого материала в заказе, даты внутри материала уникальны.
 *
 * Проверка возвращает результат, а не пишет ответ: вызывающие сидят внутри своих транзакций и
 * откатывают их по-разному.
 */
import type { PoolClient } from 'pg';

/** Допуск сверки суммы: тот же, что на клиенте (client/src/pages/requests/orderSchedule.ts). */
const SCHED_EPS = 1e-6;

export interface ScheduleLineInput {
  aggKey: string;
  entries: { deliveryDate: string; quantity: number }[];
}

export type ScheduleResult = { ok: true } | { ok: false; error: string };

/**
 * Заменить график по переданным agg_key (REPLACE, а не merge: клиент присылает материал целиком).
 * Материалы, которых нет в payload, не затрагиваются.
 */
export async function replaceSchedule(
  client: PoolClient,
  orderId: string,
  lines: ScheduleLineInput[],
): Promise<ScheduleResult> {
  const { rows: aggRows } = await client.query(
    `SELECT agg_key, SUM(quantity)::numeric AS qty FROM supplier_order_items WHERE order_id = $1 GROUP BY agg_key`,
    [orderId],
  );
  const aggQty = new Map<string, number>(aggRows.map((a) => [a.agg_key as string, Number(a.qty)]));

  for (const line of lines) {
    if (!aggQty.has(line.aggKey)) {
      return { ok: false, error: 'График задан по материалу вне состава заказа' };
    }
    const dates = line.entries.map((e) => e.deliveryDate);
    if (new Set(dates).size !== dates.length) {
      return { ok: false, error: 'Даты поставки в графике не должны повторяться' };
    }
    const sum = line.entries.reduce((s, e) => s + e.quantity, 0);
    if (Math.abs(sum - (aggQty.get(line.aggKey) ?? 0)) > SCHED_EPS) {
      return { ok: false, error: 'Сумма графика не совпадает с количеством материала в заказе' };
    }
  }

  await client.query(
    `DELETE FROM supplier_order_delivery_schedule WHERE order_id = $1 AND agg_key = ANY($2::text[])`,
    [orderId, lines.map((l) => l.aggKey)],
  );
  for (const line of lines) {
    for (const e of line.entries) {
      await client.query(
        `INSERT INTO supplier_order_delivery_schedule (order_id, agg_key, delivery_date, quantity)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (order_id, agg_key, delivery_date) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [orderId, line.aggKey, e.deliveryDate, e.quantity],
      );
    }
  }
  return { ok: true };
}
