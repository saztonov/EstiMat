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

/**
 * Сериализовать работу с заявками одной сметы. Берётся ПЕРВЫМ после BEGIN — до любых row-lock
 * (projects FOR UPDATE и т.п.), чтобы порядок захвата был одинаков во всех путях и не давал
 * дедлока.
 *
 * Синхронизирует создание заявки с согласованием материалов: сводка видимых ключей и вставка
 * строк должны быть атомарны относительно relink (иначе новая txt-строка заявки «проскочит»
 * мимо переноса на id-ключ). От ПРОЧИХ правок сметы лок не защищает — их ловит сверка строк
 * с канонической сводкой внутри той же транзакции.
 */
export async function lockEstimateRequests(db: Db, estimateId: string): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('estimat:material_request'), hashtext($1))`, [
    estimateId,
  ]);
}

/** Канонические данные материала сметы — источник истины для строк заявки. */
export interface CanonicalMaterial {
  costTypeId: string | null;
  aggKey: string;
  materialId: string | null;
  name: string;
  unit: string;
}

/**
 * Видимая подрядчику сводка материалов сметы: ключ заявки → канонические данные материала
 * по его назначенным строкам. Заявка принимается только по этим материалам, а имя/единица/
 * material_id берутся отсюда, а не из тела запроса: клиент не источник истины о смете.
 */
export async function loadVisibleMaterials(
  db: Db,
  estimateId: string,
  contractorId: string,
): Promise<Map<string, CanonicalMaterial>> {
  const { rows } = await db.query(
    `SELECT ei.cost_type_id, em.material_id, em.unit,
            COALESCE(mc.name, em.description, 'Материал') AS name
       FROM estimate_item_contractors eic
       JOIN estimate_items ei     ON ei.id = eic.item_id
       JOIN estimate_materials em ON em.item_id = ei.id
       LEFT JOIN material_catalog mc ON em.material_id = mc.id
      WHERE eic.estimate_id = $1 AND eic.contractor_id = $2`,
    [estimateId, contractorId],
  );
  const map = new Map<string, CanonicalMaterial>();
  for (const r of rows) {
    const costTypeId = r.cost_type_id ?? null;
    const key = aggKey(r.material_id ?? null, r.name, r.unit);
    // Один ключ свёртки могут дать несколько строк сметы (разные работы одного вида).
    // Данные у них совпадают по построению ключа — берём первую.
    map.set(lineKey(costTypeId, key), {
      costTypeId,
      aggKey: key,
      materialId: r.material_id ?? null,
      name: r.name,
      unit: r.unit,
    });
  }
  return map;
}

// Доступ подрядчика к смете объекта (проект назначен его организации). Для заявки от имени
// подрядчика вызывается с выбранным contractorId, а не с организацией пользователя.
export async function assertContractorEstimateAccess(
  db: Db,
  estimateId: string,
  contractorId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM estimates e
       JOIN project_contractors pc ON pc.project_id = e.project_id
      WHERE e.id = $1 AND pc.contractor_id = $2`,
    [estimateId, contractorId],
  );
  return rows.length > 0;
}

/** Множество видимых ключей — обёртка над loadVisibleMaterials (один запрос, один источник). */
export async function visibleMaterialKeys(
  db: Db,
  estimateId: string,
  contractorId: string,
): Promise<Set<string>> {
  return new Set((await loadVisibleMaterials(db, estimateId, contractorId)).keys());
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
