/**
 * Пересчёт канонического статуса заявки по ФАКТАМ (не ручная установка).
 *   revision          — явное состояние, пересчётом не трогается (выход только через revision-complete);
 *   нет прямого заказа → in_work;
 *   есть заказ, оплаты < суммы → supplier_selected;
 *   оплаты покрыли сумму заказа → paid.
 * (delivered — поставки, следующая фаза.)
 * Вызывать внутри той же транзакции после доменной операции (создание/правка заказа, оплата).
 */
import type { Pool, PoolClient } from 'pg';
import { appendRequestAudit } from '../material-requests/access.js';

type Db = Pool | PoolClient;

export async function recalcRequestStatus(
  db: Db,
  requestId: string,
  actorId?: string | null,
): Promise<string> {
  const { rows: reqRows } = await db.query(
    `SELECT status, estimate_id, project_id FROM material_requests WHERE id = $1`,
    [requestId],
  );
  const req = reqRows[0];
  if (!req) return 'in_work';

  // Доработка — состояние процесса, пересчётом не переопределяется.
  if (req.status === 'revision') return 'revision';

  const { rows: orderRows } = await db.query(
    `SELECT id, amount FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1`,
    [requestId],
  );
  const order = orderRows[0];

  let target = 'in_work';
  if (order) {
    const { rows: payRows } = await db.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM supplier_order_payments WHERE order_id = $1`,
      [order.id],
    );
    const paid = Number(payRows[0].paid);
    target = paid >= Number(order.amount) ? 'paid' : 'supplier_selected';
  }

  if (target !== req.status) {
    await db.query(
      `UPDATE material_requests
          SET status = $2, status_changed_at = now(), status_changed_by = $3,
              row_version = row_version + 1
        WHERE id = $1`,
      [requestId, target, actorId ?? null],
    );
    await appendRequestAudit(db, {
      requestId,
      action: 'status_changed',
      userId: actorId,
      changes: { from: req.status, to: target, auto: true },
      estimateId: req.estimate_id,
      projectId: req.project_id,
    });
  }

  return target;
}
