/**
 * Хелперы контура снабжения СУ-10 (закупочные лоты, supplier_orders.kind='sourcing').
 *   - appendOrderAudit — доменное событие лота в несгораемый журнал (audit_log).
 *   - hasActiveAllocations — есть ли позиции заявки в активных лотах (для запрета доработки/отмены,
 *     инвариант И3: доработка удаляет и пересоздаёт material_request_items, что осиротило бы лоты).
 */
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

// Стадии лота, где состав заморожен: лот ушёл в закупку, ждёт согласования или уже присуждён.
// Единое определение «активной закупки» для запрета отмены/доработки заявки, признака в списке и
// удаления заявки. 'approval' входит сюда обязательно: на согласовании руководитель видит
// конкретный состав и сумму, и менять их под ним нельзя.
export const FROZEN_LOT_STATUSES = ['sourcing', 'approval', 'awarded', 'cancel_pending'] as const;

// Стадии, на которых опустевший лот можно удалить физически: черновик и терминальные. Лоты из
// FROZEN_LOT_STATUSES не удаляем — за ними внешний тендер (см. outbox-worker) и/или финансы.
export const DELETABLE_LOT_STATUSES = ['forming', 'cancelled', 'no_award'] as const;

export async function appendOrderAudit(
  db: Db,
  params: {
    orderId: string;
    action: string;
    userId?: string | null;
    changes?: unknown;
    projectId?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes, project_id)
     VALUES ('supplier_order', $1, $2, $3, $4, $5)`,
    [
      params.orderId,
      params.action,
      params.userId ?? null,
      JSON.stringify(params.changes ?? {}),
      params.projectId ?? null,
    ],
  );
}

// Позиции заявки заняты активным лотом (не терминальные cancelled/no_award): доработку/отмену
// заявки блокируем (осиротило бы лоты). Освобождённые лоты (cancelled/no_award) не блокируют.
export async function hasActiveAllocations(db: Db, requestId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM supplier_order_items soi
        JOIN supplier_orders so ON so.id = soi.order_id
       WHERE soi.request_id = $1 AND so.kind = 'sourcing' AND so.sourcing_status NOT IN ('cancelled','no_award')
     ) AS active`,
    [requestId],
  );
  return rows[0]?.active === true;
}

// Позиции заявки в лотах, ушедших в закупку (sourcing/awarded/cancel_pending) — состав заморожен,
// освободить их отменой заявки нельзя (снабжение сначала отменяет лот). Только для su10-заявок.
export async function hasFrozenAllocations(db: Db, requestId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM supplier_order_items soi
        JOIN supplier_orders so ON so.id = soi.order_id
       WHERE soi.request_id = $1 AND so.kind = 'sourcing'
         AND so.sourcing_status = ANY($2::text[])
     ) AS frozen`,
    [requestId, FROZEN_LOT_STATUSES],
  );
  return rows[0]?.frozen === true;
}

// Освобождение материалов заявки из ФОРМИРУЕМЫХ лотов (при отмене заявки): удаляем позиции
// таких лотов и бумпаем row_version затронутых лотов с записью в журнал. Резерв — вычисляемый,
// поэтому удаление позиций сразу возвращает остаток в свод материалов. Вызывать в транзакции.
export async function releaseFormingAllocations(
  client: PoolClient,
  requestId: string,
  userId?: string | null,
): Promise<void> {
  const { rows } = await client.query(
    `DELETE FROM supplier_order_items soi
       USING supplier_orders so
      WHERE soi.order_id = so.id AND soi.request_id = $1
        AND so.kind = 'sourcing' AND so.sourcing_status = 'forming'
      RETURNING soi.order_id`,
    [requestId],
  );
  const orderIds = [...new Set(rows.map((r) => r.order_id as string))];
  for (const orderId of orderIds) {
    const { rows: lotRows } = await client.query(
      `UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now()
        WHERE id = $1 RETURNING project_id`,
      [orderId],
    );
    await appendOrderAudit(client, {
      orderId,
      action: 'item_removed',
      userId,
      changes: { reason: 'request_cancelled' },
      projectId: lotRows[0]?.project_id ?? null,
    });
  }
}
