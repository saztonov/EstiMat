/**
 * Общие примитивы детализации сметы, используемые несколькими роутами
 * (estimates, projects, contractors, estimate-export).
 */
import type { Pool, PoolClient } from 'pg';

// Канонический порядок работ (зона → этаж → тип помещения → категория/вид → sort_order).
// Требует алиасов ei/z/rt/cc/ct в вызывающем SQL.
export const ITEMS_CANONICAL_ORDER_BY =
  `z.sort_order NULLS LAST, ei.floor_from NULLS LAST, rt.sort_order NULLS LAST,
   cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`;

// Группировка строк по ключу за один проход (вместо .filter() внутри .map() — O(n×m)).
// Порядок внутри бакета = порядок входного массива (его задаёт ORDER BY в SQL).
export function bucketBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}

// projectId сметы (для payload события и денормализации в журнал).
// Принимает и Pool, и PoolClient (вызывается в т.ч. внутри транзакций).
export async function loadProjectId(
  db: Pick<Pool | PoolClient, 'query'>,
  estimateId: string,
): Promise<string | null> {
  const { rows } = await db.query('SELECT project_id FROM estimates WHERE id = $1', [estimateId]);
  return rows[0]?.project_id ?? null;
}

export interface EstimateDetailOptions {
  // true → дополнительный запрос estimate_item_contractors и поля item_contractors/
  // assigned_total/remaining_qty/over_assigned у каждой работы (как в GET /api/estimates/:id).
  // false (default) → без этих полей (как в GET /api/projects/:id/estimate).
  includeItemContractors?: boolean;
}

// Полная детализация сметы: шапка, работы (с измерениями + авторами), материалы (вложенно),
// подрядчики по видам затрат. Возвращает null, если сметы нет (роут сам решает: 404 или data:null).
// Авторизацию НЕ делает — проверки ролей/принадлежности остаются в роутах до вызова.
export async function buildEstimateDetail(
  pool: Pool,
  estimateId: string,
  opts?: EstimateDetailOptions,
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT e.*,
            p.code AS project_code,
            p.name AS project_name,
            cc.name AS cost_category_name
     FROM estimates e
     JOIN projects p ON e.project_id = p.id
     LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
     WHERE e.id = $1`,
    [estimateId],
  );
  if (rows.length === 0) return null;

  const items = await pool.query(
    `SELECT ei.*,
            r.name  AS rate_name,
            r.code  AS rate_code,
            ct.name AS cost_type_name,
            ct.sort_order AS cost_type_sort_order,
            cc.name AS cost_category_name,
            cc.sort_order AS cost_category_sort_order,
            z.name  AS zone_name,
            z.kind  AS zone_kind,
            rt.name AS room_type_name,
            lt.name AS location_type_name,
            uc.full_name AS created_by_name,
            uu.full_name AS updated_by_name
     FROM estimate_items ei
     LEFT JOIN rates r            ON ei.rate_id = r.id
     LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
     LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
     LEFT JOIN project_zones z    ON ei.zone_id = z.id
     LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
     LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
     LEFT JOIN users uc           ON ei.created_by = uc.id
     LEFT JOIN users uu           ON ei.updated_by = uu.id
     WHERE ei.estimate_id = $1
     ORDER BY ${ITEMS_CANONICAL_ORDER_BY}`,
    [estimateId],
  );

  const materials = await pool.query(
    `SELECT em.*, mc.name AS material_name,
            uc.full_name AS created_by_name,
            uu.full_name AS updated_by_name
     FROM estimate_materials em
     LEFT JOIN material_catalog mc ON em.material_id = mc.id
     LEFT JOIN users uc            ON em.created_by = uc.id
     LEFT JOIN users uu            ON em.updated_by = uu.id
     WHERE em.estimate_id = $1
     ORDER BY em.sort_order, em.created_at`,
    [estimateId],
  );

  const contractors = await pool.query(
    `SELECT ec.cost_type_id, ec.contractor_id,
            o.name  AS contractor_name,
            ct.name AS cost_type_name,
            ct.sort_order AS cost_type_sort_order,
            cc.id   AS cost_category_id,
            cc.name AS cost_category_name,
            cc.sort_order AS cost_category_sort_order
     FROM estimate_contractors ec
     LEFT JOIN organizations o    ON ec.contractor_id = o.id
     LEFT JOIN cost_types ct      ON ec.cost_type_id = ct.id
     LEFT JOIN cost_categories cc ON ct.category_id = cc.id
     WHERE ec.estimate_id = $1`,
    [estimateId],
  );

  // Бакетизация по item_id за один проход вместо вложенных .filter() внутри .map()
  // (было O(items × строк)). Порядок сохраняется: SQL уже отсортировал строки (ORDER BY),
  // а вставка в Map идёт в том же порядке.
  const materialsByItem = bucketBy(materials.rows, (m) => m.item_id as string);

  let itemsOut: Record<string, unknown>[];
  if (opts?.includeItemContractors) {
    // Построчные назначения подрядчиков (раздел «Подрядчики»): подрядчики строки,
    // распределённый объём, остаток без подрядчика и признак over-assigned.
    const itemContractors = await pool.query(
      `SELECT eic.item_id, eic.contractor_id, eic.assigned_qty, eic.assigned_percent,
              COALESCE(eic.assigned_qty, ei.quantity * eic.assigned_percent / 100.0, ei.quantity) AS effective_qty,
              o.name AS contractor_name
         FROM estimate_item_contractors eic
         JOIN estimate_items ei      ON ei.id = eic.item_id
         LEFT JOIN organizations o   ON o.id = eic.contractor_id
        WHERE eic.estimate_id = $1
        ORDER BY eic.assigned_at`,
      [estimateId],
    );
    const contractorsByItem = bucketBy(itemContractors.rows, (c) => c.item_id as string);

    itemsOut = items.rows.map((it) => {
      const its = contractorsByItem.get(it.id) ?? [];
      const assignedTotal = its.reduce((s, c) => s + Number(c.effective_qty), 0);
      const qty = Number(it.quantity);
      return {
        ...it,
        materials: materialsByItem.get(it.id) ?? [],
        item_contractors: its,
        assigned_total: assignedTotal,
        remaining_qty: Math.max(qty - assignedTotal, 0),
        over_assigned: assignedTotal > qty + 1e-6,
      };
    });
  } else {
    itemsOut = items.rows.map((it) => ({
      ...it,
      materials: materialsByItem.get(it.id) ?? [],
    }));
  }

  return {
    ...rows[0],
    items: itemsOut,
    contractors: contractors.rows,
  };
}
