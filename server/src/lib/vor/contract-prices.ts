// Договорные цены строк сметы: чьи они и когда перестают действовать.
//
// Договорная цена приходит из заполненного подрядчиком ВОР и принадлежит конкретному подрядчику
// (contract_price_contractor_id). Как только исполнитель строки перестал быть тем же самым —
// сменился, добавился второй, снят вовсе — цена больше не описывает договор с текущим
// исполнителем, и её нельзя оставлять: иначе новый подрядчик молча «наследует» чужой прайс.
//
// Вызывается из всех путей изменения назначений (назначение по ВОР, построчное, массовое, снятие).

import type { Pool, PoolClient } from 'pg';

type Db = Pick<Pool | PoolClient, 'query'>;

const CLEAR_COLUMNS = `contract_unit_price = NULL,
       contract_price_vor_id = NULL,
       contract_price_contractor_id = NULL,
       contract_price_updated_at = NULL,
       contract_price_updated_by = NULL`;

/**
 * Снять договорные цены со строк, у которых цена принадлежит уже не текущему единственному
 * исполнителю (в т.ч. когда исполнителей стало несколько или не осталось совсем). Цены строк,
 * где исполнитель тот же, сохраняются: повторное назначение того же подрядчика — не повод
 * терять согласованный прайс.
 *
 * Возвращает число работ, с которых цены сняты (вместе с их материалами).
 */
export async function clearStaleContractPrices(db: Db, itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;

  // Строки, где владелец цены разошёлся с фактическим единственным исполнителем. sole = NULL,
  // если исполнителей нет или их несколько — тогда любая проставленная цена считается чужой.
  const { rows } = await db.query(
    `WITH scope AS (SELECT unnest($1::uuid[]) AS item_id),
          holders AS (
            SELECT s.item_id,
                   array_agg(DISTINCT eic.contractor_id)
                     FILTER (WHERE eic.contractor_id IS NOT NULL) AS contractors
              FROM scope s
              LEFT JOIN estimate_item_contractors eic ON eic.item_id = s.item_id
             GROUP BY s.item_id
          ),
          sole AS (
            SELECT item_id,
                   CASE WHEN array_length(contractors, 1) = 1 THEN contractors[1] END AS contractor_id
              FROM holders
          )
     SELECT s.item_id
       FROM sole s
      WHERE EXISTS (
              SELECT 1 FROM estimate_items ei
               WHERE ei.id = s.item_id
                 AND ei.contract_price_contractor_id IS NOT NULL
                 AND ei.contract_price_contractor_id IS DISTINCT FROM s.contractor_id
            )
         OR EXISTS (
              SELECT 1 FROM estimate_materials em
               WHERE em.item_id = s.item_id
                 AND em.contract_price_contractor_id IS NOT NULL
                 AND em.contract_price_contractor_id IS DISTINCT FROM s.contractor_id
            )`,
    [itemIds],
  );
  const staleIds = rows.map((r) => r.item_id as string);
  if (staleIds.length === 0) return 0;

  await db.query(
    `UPDATE estimate_materials SET ${CLEAR_COLUMNS}
      WHERE item_id = ANY($1::uuid[]) AND contract_price_contractor_id IS NOT NULL`,
    [staleIds],
  );
  await db.query(
    `UPDATE estimate_items SET ${CLEAR_COLUMNS}
      WHERE id = ANY($1::uuid[]) AND contract_price_contractor_id IS NOT NULL`,
    [staleIds],
  );
  return staleIds.length;
}
