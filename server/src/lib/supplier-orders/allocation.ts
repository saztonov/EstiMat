/**
 * Инвариант И1: нельзя заказать больше, чем заявлено.
 *
 * Резерв в системе ВЫЧИСЛЯЕМЫЙ — «размещено» это SUM(supplier_order_items.quantity) по заказам вне
 * терминальных стадий. Поэтому проверка всегда выглядит как «хочу ≤ заявлено − размещённое где-то
 * ещё», и что именно считать «где-то ещё», зависит от вызывающего: при формировании заказа из
 * подсчёта исключается сам заказ (его позиции переписываются целиком), при правке одной строки —
 * ещё и она сама, иначе её текущее количество учлось бы дважды и любое увеличение отклонялось бы.
 *
 * Считаем в SQL numeric: количества дробные, и накопленная ошибка float дала бы ложный отказ.
 */
import type { PoolClient } from 'pg';

export interface AllocationWant {
  requestItemId: string;
  /** Желаемое АБСОЛЮТНОЕ количество позиции в заказе (не приращение). */
  quantity: number;
}

export interface AllocationViolation {
  requestItemId: string;
  name: string;
  /** Сколько ещё доступно с учётом исключений. */
  remaining: number;
  /** Сколько запрошено. */
  requested: number;
}

/**
 * Проверить, что запрошенные количества помещаются в остаток заявок.
 * Возвращает список нарушений (пустой — всё помещается).
 *
 * @param excludeOrderId  заказ, чьё размещение не учитывается (его позиции и переписываем)
 * @param excludeItemId   конкретная строка заказа, которую правим (её вклад тоже не учитываем)
 */
export async function assertRemainingFits(
  client: PoolClient,
  wants: AllocationWant[],
  excludeOrderId: string,
  excludeItemId?: string,
): Promise<AllocationViolation[]> {
  if (!wants.length) return [];

  const { rows } = await client.query(
    `WITH req(request_item_id, want) AS (
       SELECT * FROM unnest($1::uuid[], $2::numeric[])
     )
     SELECT req.request_item_id::text AS request_item_id, mri.material_name,
            mri.quantity AS requested, COALESCE(pl.qty, 0) AS placed, req.want
       FROM req
       JOIN material_request_items mri ON mri.id = req.request_item_id
       LEFT JOIN (
         SELECT soi.request_item_id, SUM(soi.quantity) AS qty
           FROM supplier_order_items soi
           JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status NOT IN ('cancelled','no_award')
          WHERE soi.order_id <> $3 AND ($4::uuid IS NULL OR soi.id <> $4)
          GROUP BY soi.request_item_id
       ) pl ON pl.request_item_id = req.request_item_id
      WHERE req.want > mri.quantity - COALESCE(pl.qty, 0)`,
    [
      wants.map((w) => w.requestItemId),
      wants.map((w) => String(w.quantity)),
      excludeOrderId,
      excludeItemId ?? null,
    ],
  );

  return rows.map((v) => ({
    requestItemId: v.request_item_id as string,
    name: v.material_name as string,
    remaining: Number(v.requested) - Number(v.placed),
    requested: Number(v.want),
  }));
}
