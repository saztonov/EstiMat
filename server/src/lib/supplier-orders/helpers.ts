/**
 * Хелперы контура снабжения СУ-10 (закупочные лоты, supplier_orders.kind='sourcing').
 *   - appendOrderAudit — доменное событие лота в несгораемый журнал (audit_log).
 *   - hasActiveAllocations — есть ли позиции заявки в активных лотах (для запрета доработки/отмены,
 *     инвариант И3: доработка удаляет и пересоздаёт material_request_items, что осиротило бы лоты).
 */
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

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

// Позиции заявки заняты активным лотом (стадия ≠ 'cancelled'): доработку/отмену заявки блокируем.
export async function hasActiveAllocations(db: Db, requestId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM supplier_order_items soi
        JOIN supplier_orders so ON so.id = soi.order_id
       WHERE soi.request_id = $1 AND so.kind = 'sourcing' AND so.sourcing_status <> 'cancelled'
     ) AS active`,
    [requestId],
  );
  return rows[0]?.active === true;
}
