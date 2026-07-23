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

/**
 * Шифры РД, назначенные видам работ сметы → { [costTypeId]: [{id, code}] }.
 * Отдельная функция, а не часть buildEstimateDetail: тот же индекс нужен разделу «Подрядчики»
 * (GET /contractors/my-items), где полной детализации сметы не строят.
 */
export async function fetchCostTypeCiphers(
  db: Pick<Pool | PoolClient, 'query'>,
  estimateId: string,
): Promise<Record<string, { id: string; code: string }[]>> {
  const { rows } = await db.query(
    `SELECT ectc.cost_type_id, c.id, c.code
       FROM estimate_cost_type_ciphers ectc
       JOIN project_rd_ciphers c ON c.id = ectc.cipher_id
      WHERE ectc.estimate_id = $1
      ORDER BY c.code`,
    [estimateId],
  );
  const out: Record<string, { id: string; code: string }[]> = {};
  for (const r of rows) {
    const k = r.cost_type_id as string;
    (out[k] ??= []).push({ id: r.id as string, code: r.code as string });
  }
  return out;
}

export interface EstimateDetailOptions {
  // true → дополнительный запрос estimate_item_contractors и поля item_contractors/
  // request_locked_contractor_ids у каждой работы (как в GET /api/estimates/:id).
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

  // Независимые запросы детализации параллелим, но ограничиваем fan-out до ~3 одновременных
  // соединений пула: одна открытая смета не должна занимать 6 коннектов (иначе деградирует
  // p95/p99 при конкурентных открытиях). Тяжёлые items/materials — по своей ветви, остальные
  // (лёгкие агрегаты + опциональные построчные подрядчики) — последовательной цепочкой в третьей.
  const itemsPromise = pool.query(
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
            uu.full_name AS updated_by_name,
            COALESCE(cmt.comment_count, 0) AS comment_count
     FROM estimate_items ei
     LEFT JOIN rates r            ON ei.rate_id = r.id
     LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
     LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
     LEFT JOIN project_zones z    ON ei.zone_id = z.id
     LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
     LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
     LEFT JOIN users uc           ON ei.created_by = uc.id
     LEFT JOIN users uu           ON ei.updated_by = uu.id
     LEFT JOIN (
       SELECT item_id, count(*)::int AS comment_count
         FROM estimate_comments
        WHERE estimate_id = $1 AND item_id IS NOT NULL
        GROUP BY item_id
     ) cmt ON cmt.item_id = ei.id
     WHERE ei.estimate_id = $1
     ORDER BY ${ITEMS_CANONICAL_ORDER_BY}`,
    [estimateId],
  );

  const materialsPromise = pool.query(
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

  const restPromise = (async () => {
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
    // Счётчики комментариев по видам работ → { [costTypeId]: number }.
    const costTypeCommentRows = await pool.query(
      `SELECT cost_type_id, count(*)::int AS count
         FROM estimate_comments
        WHERE estimate_id = $1 AND cost_type_id IS NOT NULL
        GROUP BY cost_type_id`,
      [estimateId],
    );
    // Шифры РД по видам работ → { [costTypeId]: [{id, code}] }.
    const costTypeCiphers = await fetchCostTypeCiphers(pool, estimateId);
    // Построчные назначения подрядчиков (раздел «Подрядчики») — только когда запрошены.
    const itemContractors = opts?.includeItemContractors
      ? await pool.query(
          `SELECT eic.item_id, eic.contractor_id, o.name AS contractor_name
             FROM estimate_item_contractors eic
             LEFT JOIN organizations o ON o.id = eic.contractor_id
            WHERE eic.estimate_id = $1
            ORDER BY eic.assigned_at`,
          [estimateId],
        )
      : null;
    // Назначения, защищённые заявками на материалы: по строке уже заказано, поэтому снять или
    // заменить подрядчика нельзя. Нужны разделу «Подрядчики» — замок на чипе исполнителя.
    // Авторитет остаётся за роутами назначения/снятия ВОР: они пересчитывают то же самое под
    // FOR UPDATE, так что слегка устаревшее поле безопасно.
    const lockedContractors = opts?.includeItemContractors
      ? await pool.query(
          `WITH live AS (
             SELECT mr.id, mr.contractor_id
               FROM material_requests mr
              WHERE mr.estimate_id = $1 AND mr.status <> 'cancelled'
           )
           SELECT src.item_id, l.contractor_id
             FROM material_request_item_sources src
             JOIN material_request_items mri ON mri.id = src.request_item_id
             JOIN live l ON l.id = mri.request_id
            WHERE mri.link_resolution IN ('exact', 'reconstructed')
           UNION
           -- Позиции без связи (старые заявки): блокируем весь вид работ подрядчика.
           SELECT ei.id, l.contractor_id
             FROM material_request_items mri
             JOIN live l ON l.id = mri.request_id
             JOIN estimate_items ei
               ON ei.estimate_id = $1
              AND ei.cost_type_id IS NOT DISTINCT FROM mri.cost_type_id
            WHERE mri.link_resolution = 'unresolved'`,
          [estimateId],
        )
      : null;
    return { contractors, costTypeCommentRows, costTypeCiphers, itemContractors, lockedContractors };
  })();

  const [items, materials, rest] = await Promise.all([itemsPromise, materialsPromise, restPromise]);
  const { contractors, costTypeCommentRows, costTypeCiphers, itemContractors, lockedContractors } = rest;

  const costTypeCommentCounts: Record<string, number> = {};
  for (const r of costTypeCommentRows.rows) costTypeCommentCounts[r.cost_type_id as string] = r.count as number;

  // Бакетизация по item_id за один проход вместо вложенных .filter() внутри .map()
  // (было O(items × строк)). Порядок сохраняется: SQL уже отсортировал строки (ORDER BY),
  // а вставка в Map идёт в том же порядке.
  const materialsByItem = bucketBy(materials.rows, (m) => m.item_id as string);

  let itemsOut: Record<string, unknown>[];
  if (itemContractors) {
    // Исполнитель строки и подрядчики, которых с неё не снять из-за оформленных заявок.
    const contractorsByItem = bucketBy(itemContractors.rows, (c) => c.item_id as string);
    const lockedByItem = bucketBy(lockedContractors?.rows ?? [], (r) => r.item_id as string);

    itemsOut = items.rows.map((it) => ({
      ...it,
      materials: materialsByItem.get(it.id) ?? [],
      item_contractors: contractorsByItem.get(it.id) ?? [],
      request_locked_contractor_ids: (lockedByItem.get(it.id) ?? []).map((r) => r.contractor_id as string),
    }));
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
    cost_type_comment_counts: costTypeCommentCounts,
    cost_type_ciphers: costTypeCiphers,
  };
}
