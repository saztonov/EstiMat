/**
 * Общие хелперы заявок на материалы: ключи свёртки, доступ подрядчика, видимые материалы,
 * запись в журнал (audit_log). Переиспользуются старым estimate-scoped модулем и новым
 * разделом «Заявки».
 */
import { aggKey, lineKey } from '@estimat/shared';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

// Ключи свёртки и заявки живут в @estimat/shared — один формат на клиент и сервер.
// Реэкспорт сохранён: на него уже импортируются routes/requests.
export { aggKey, lineKey };

// Доступ подрядчика к смете объекта (проект назначен его организации).
export async function assertContractorEstimateAccess(
  db: Db,
  estimateId: string,
  orgId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM estimates e
       JOIN project_contractors pc ON pc.project_id = e.project_id
      WHERE e.id = $1 AND pc.contractor_id = $2`,
    [estimateId, orgId],
  );
  return rows.length > 0;
}

// Видимая подрядчику сводка материалов сметы: множество ключей (cost_type_id, agg_key)
// по его назначенным строкам. Заявка принимается только по этим материалам.
export async function visibleMaterialKeys(
  db: Db,
  estimateId: string,
  orgId: string,
): Promise<Set<string>> {
  const { rows } = await db.query(
    `SELECT ei.cost_type_id, em.material_id, em.unit,
            COALESCE(mc.name, em.description, 'Материал') AS name
       FROM estimate_item_contractors eic
       JOIN estimate_items ei     ON ei.id = eic.item_id
       JOIN estimate_materials em ON em.item_id = ei.id
       LEFT JOIN material_catalog mc ON em.material_id = mc.id
      WHERE eic.estimate_id = $1 AND eic.contractor_id = $2`,
    [estimateId, orgId],
  );
  const set = new Set<string>();
  for (const r of rows) {
    set.add(lineKey(r.cost_type_id ?? null, aggKey(r.material_id ?? null, r.name, r.unit)));
  }
  return set;
}

// Запись доменного события заявки в несгораемый журнал (лента истории карточки).
export async function appendRequestAudit(
  db: Db,
  params: {
    requestId: string;
    action: string;
    userId?: string | null;
    changes?: unknown;
    estimateId?: string | null;
    projectId?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes, estimate_id, project_id)
     VALUES ('material_request', $1, $2, $3, $4, $5, $6)`,
    [
      params.requestId,
      params.action,
      params.userId ?? null,
      JSON.stringify(params.changes ?? {}),
      params.estimateId ?? null,
      params.projectId ?? null,
    ],
  );
}
