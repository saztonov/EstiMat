/**
 * Пересчёт канонического статуса заявки по ФАКТАМ (не ручная установка). Type-aware.
 *
 * own_supplier (маршрут РП):
 *   revision / cancelled / in_work / rp_forming — состояния процесса, пересчётом не трогаются
 *   (rp_forming/rp_sent — ручные переходы роутов);
 *   rp_sent ↔ rp_paid — авто по покрытию суммы счёта незасторнированными оплатами.
 *
 * su10 / own_supply (прочие маршруты — прежнее поведение):
 *   revision — не трогается; нет заказа → in_work; есть заказ, оплаты < суммы → supplier_selected;
 *   оплаты ≥ суммы → paid. (delivered — поставки, следующая фаза.)
 *
 * Сравнение сумм — в PostgreSQL (numeric), без потери точности через JS Number.
 * Вызывать внутри той же транзакции после доменной операции (создание/правка заказа, оплата).
 */
import type { Pool, PoolClient } from 'pg';
import { appendRequestAudit } from '../material-requests/access.js';

type Db = Pool | PoolClient;

/**
 * Полностью ли покрыты ВСЕ актуальные строки su10-заявки присуждёнными лотами
 * (sourcing_status='awarded'). Сравнение количеств — в SQL (numeric). Пустая заявка → false.
 */
async function su10FullyCovered(db: Db, requestId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM material_request_items WHERE request_id = $1) AS has_items,
            NOT EXISTS (
              SELECT 1 FROM material_request_items mri
               WHERE mri.request_id = $1
                 AND mri.quantity > COALESCE((
                       SELECT SUM(soi.quantity) FROM supplier_order_items soi
                         JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status = 'awarded'
                        WHERE soi.request_item_id = mri.id), 0)
            ) AS covered`,
    [requestId],
  );
  return rows[0]?.has_items === true && rows[0]?.covered === true;
}

/** Покрыта ли сумма заказа незасторнированными оплатами (numeric-сравнение в SQL). */
async function orderCovered(db: Db, orderId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT (COALESCE(SUM(p.amount), 0) >= o.amount) AS covered
       FROM supplier_orders o
       LEFT JOIN supplier_order_payments p ON p.order_id = o.id AND NOT p.reversed
      WHERE o.id = $1
      GROUP BY o.amount`,
    [orderId],
  );
  return rows[0]?.covered === true;
}

async function applyTarget(
  db: Db,
  requestId: string,
  from: string,
  target: string,
  req: { estimate_id: string | null; project_id: string | null },
  actorId?: string | null,
): Promise<void> {
  if (target === from) return;
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
    changes: { from, to: target, auto: true },
    estimateId: req.estimate_id,
    projectId: req.project_id,
  });
}

export async function recalcRequestStatus(
  db: Db,
  requestId: string,
  actorId?: string | null,
): Promise<string> {
  const { rows: reqRows } = await db.query(
    `SELECT status, request_type, estimate_id, project_id FROM material_requests WHERE id = $1`,
    [requestId],
  );
  const req = reqRows[0];
  if (!req) return 'in_work';

  // Явные состояния процесса — пересчётом не переопределяются.
  if (req.status === 'revision' || req.status === 'cancelled') return req.status;

  const { rows: orderRows } = await db.query(
    `SELECT id FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1`,
    [requestId],
  );
  const order = orderRows[0];

  // ===== Маршрут РП (own_supplier) =====
  if (req.request_type === 'own_supplier') {
    // in_work / rp_forming — ручные переходы, авто не двигаем.
    if (req.status === 'in_work' || req.status === 'rp_forming') return req.status;
    // После отправки РП: авто rp_sent ↔ rp_paid по покрытию суммы оплатами.
    if (req.status === 'rp_sent' || req.status === 'rp_paid') {
      const target = order && (await orderCovered(db, order.id)) ? 'rp_paid' : 'rp_sent';
      await applyTarget(db, requestId, req.status, target, req, actorId);
      return target;
    }
    return req.status;
  }

  // ===== Закупка через СУ-10 (su10) — покрытие по присуждённым закупочным лотам =====
  // Поставщика выбирает снабжение через лоты (kind='sourcing'); прямого заказа (kind='direct') нет.
  //   все актуальные строки покрыты awarded-лотами → supplier_selected; иначе → in_work
  //   (частичное покрытие — прогресс показываем отдельно, статусом не двигаем).
  if (req.request_type === 'su10') {
    const target = (await su10FullyCovered(db, requestId)) ? 'supplier_selected' : 'in_work';
    await applyTarget(db, requestId, req.status, target, req, actorId);
    return target;
  }

  // ===== Собственная закупка (own_supply) — прежнее поведение (прямой заказ) =====
  let target = 'in_work';
  if (order) {
    target = (await orderCovered(db, order.id)) ? 'paid' : 'supplier_selected';
  }
  await applyTarget(db, requestId, req.status, target, req, actorId);
  return target;
}
