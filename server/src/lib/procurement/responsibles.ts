/**
 * Ответственные за закупки: единый резолвер и общие SQL-хелперы.
 *
 * Приоритет уровней (0071): материал (объект+подрядчик+вид+материал) → вид затрат → категория.
 * Поверх найденного применяется активное замещение (0072): на время отпуска/болезни фактическим
 * ответственным становится заместитель, исходное назначение сохраняется и возвращается само.
 *
 * Правило разрешения нужно в пяти местах — своде материалов, справочнике, карточке сотрудника,
 * проверке прав на заказ и наследовании в заявки. Держим его ЗДЕСЬ в одной функции: расхождение
 * «интерфейс показывает одного, а заказ создаёт другой» — самый дорогой класс ошибок в этом узле.
 */
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

/** Область материального назначения — ключ строки свода «Материалы». */
export interface MaterialScopeKey {
  projectId: string | null;
  contractorId: string | null;
  costTypeId: string | null;
  aggKey: string;
}

export type ResponsibleSource = 'material' | 'type' | 'category' | null;

export interface ResolvedResponsible {
  /** Кто назначен по справочнику/точечно (без учёта замещения). */
  assignedUserId: string | null;
  assignedName: string | null;
  /** Уровень, с которого пришло назначение — для подписи «наследует» в интерфейсе. */
  source: ResponsibleSource;
  /** Кто фактически отвечает сегодня (замещающий, если период активен). */
  effectiveUserId: string | null;
  effectiveName: string | null;
  /** Активное замещение, если оно подменило ответственного. */
  substitutionId: string | null;
}

const EMPTY: ResolvedResponsible = {
  assignedUserId: null, assignedName: null, source: null,
  effectiveUserId: null, effectiveName: null, substitutionId: null,
};

/** Стабильный ключ области для сопоставления результатов с входным списком. */
export function scopeKey(s: MaterialScopeKey): string {
  return [s.projectId ?? '', s.contractorId ?? '', s.costTypeId ?? '', s.aggKey].join('|');
}

/**
 * Разрешить эффективного ответственного для набора областей. Возвращает карту scopeKey → результат;
 * области без единого назначения на всех трёх уровнях получают пустой результат (не ошибку) —
 * это штатное состояние «никто не назначен», у которого своя семантика доступа (см. access.ts).
 */
export async function resolveResponsibles(
  db: Db,
  scopes: MaterialScopeKey[],
): Promise<Map<string, ResolvedResponsible>> {
  const out = new Map<string, ResolvedResponsible>();
  if (scopes.length === 0) return out;

  // Дедуп по ключу: одна и та же область обычно приходит из нескольких строк свода.
  const uniq = new Map<string, MaterialScopeKey>();
  for (const s of scopes) uniq.set(scopeKey(s), s);
  const list = [...uniq.values()];

  const { rows } = await db.query(
    `WITH scope(project_id, contractor_id, cost_type_id, agg_key) AS (
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[])
     ),
     -- Материальный уровень: IS NOT DISTINCT FROM, а не '=' — поля nullable, и обычное
     -- сравнение не сматчило бы области без объекта/подрядчика/вида.
     mat AS (
       SELECT s.project_id, s.contractor_id, s.cost_type_id, s.agg_key,
              pmr.user_id
         FROM scope s
         LEFT JOIN procurement_material_responsible pmr
                ON pmr.project_id    IS NOT DISTINCT FROM s.project_id
               AND pmr.contractor_id IS NOT DISTINCT FROM s.contractor_id
               AND pmr.cost_type_id  IS NOT DISTINCT FROM s.cost_type_id
               AND pmr.agg_key = s.agg_key
     )
     SELECT m.project_id, m.contractor_id, m.cost_type_id, m.agg_key,
            COALESCE(m.user_id, v.assigned_user_id) AS assigned_user_id,
            CASE WHEN m.user_id IS NOT NULL THEN 'material' ELSE v.assigned_source END AS source,
            -- Замещение материального уровня разрешается здесь же; для видов/категорий его уже
            -- применило вью, поэтому берём его effective_user_id как есть.
            COALESCE(msub.deputy_user_id, m.user_id, v.effective_user_id) AS effective_user_id,
            COALESCE(msub.id, CASE WHEN m.user_id IS NULL THEN v.substitution_id END) AS substitution_id,
            au.full_name AS assigned_name,
            eu.full_name AS effective_name
       FROM mat m
       LEFT JOIN v_procurement_responsible_effective v ON v.cost_type_id = m.cost_type_id
       LEFT JOIN procurement_substitutions msub
              ON m.user_id IS NOT NULL
             AND msub.principal_user_id = m.user_id
             AND msub.ended_at IS NULL
             AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN msub.starts_on AND msub.ends_on
       LEFT JOIN users au ON au.id = COALESCE(m.user_id, v.assigned_user_id)
       LEFT JOIN users eu ON eu.id = COALESCE(msub.deputy_user_id, m.user_id, v.effective_user_id)`,
    [
      list.map((s) => s.projectId),
      list.map((s) => s.contractorId),
      list.map((s) => s.costTypeId),
      list.map((s) => s.aggKey),
    ],
  );

  for (const r of rows) {
    const key = scopeKey({
      projectId: r.project_id, contractorId: r.contractor_id,
      costTypeId: r.cost_type_id, aggKey: r.agg_key,
    });
    out.set(key, {
      assignedUserId: r.assigned_user_id ?? null,
      assignedName: r.assigned_name ?? null,
      source: (r.source as ResponsibleSource) ?? null,
      effectiveUserId: r.effective_user_id ?? null,
      effectiveName: r.effective_name ?? null,
      substitutionId: r.substitution_id ?? null,
    });
  }
  for (const s of list) if (!out.has(scopeKey(s))) out.set(scopeKey(s), EMPTY);
  return out;
}

/**
 * Кандидаты в ответственные: активные внутренние роли ПЛЮС те, у кого остались действующие
 * назначения, даже если пользователь деактивирован. Без второй части неактивного назначенца
 * невозможно было бы найти в поиске, чтобы снять с него область.
 */
export async function loadAssignableUsers(db: Db): Promise<unknown[]> {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.role, u.is_active
       FROM users u
      WHERE (u.is_active = true AND u.role IN ('admin', 'engineer', 'manager'))
         OR EXISTS (SELECT 1 FROM procurement_category_responsible  x WHERE x.user_id = u.id)
         OR EXISTS (SELECT 1 FROM procurement_cost_type_responsible x WHERE x.user_id = u.id)
         OR EXISTS (SELECT 1 FROM procurement_material_responsible  x WHERE x.user_id = u.id)
      ORDER BY u.full_name`,
  );
  return rows;
}

/** Кандидат обязан существовать, быть активным и не подрядчиком. */
export async function assertAssignable(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND is_active = true AND role <> 'contractor'`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Дерево справочника: категории с видами затрат и назначенными/эффективными ответственными.
 * Архивные категории и виды показываются, только если по ним есть назначение — иначе их нельзя
 * было бы снять.
 */
export async function loadResponsibleTree(db: Db): Promise<unknown[]> {
  const { rows } = await db.query(
    `SELECT cc.id, cc.name, cc.code, cc.sort_order, cc.is_active,
            cr.user_id      AS responsible_id,
            cu.full_name    AS responsible_name,
            csub.id         AS substitution_id,
            csu.full_name   AS substitute_name,
            csub.ends_on    AS substitution_ends_on,
            COALESCE((
              SELECT json_agg(t ORDER BY t.sort_order, t.name)
                FROM (
                  SELECT ct.id, ct.name, ct.code, ct.sort_order, ct.is_active,
                         tr.user_id    AS responsible_id,
                         tu.full_name  AS responsible_name,
                         v.assigned_user_id, v.assigned_source AS source,
                         v.effective_user_id,
                         eu.full_name  AS effective_name,
                         v.substitution_id AS eff_substitution_id
                    FROM cost_types ct
                    LEFT JOIN procurement_cost_type_responsible tr ON tr.cost_type_id = ct.id
                    LEFT JOIN users tu ON tu.id = tr.user_id
                    LEFT JOIN v_procurement_responsible_effective v ON v.cost_type_id = ct.id
                    LEFT JOIN users eu ON eu.id = v.effective_user_id
                   WHERE ct.category_id = cc.id
                     AND (ct.is_active = true OR tr.user_id IS NOT NULL)
                ) t
            ), '[]') AS types
       FROM cost_categories cc
       LEFT JOIN procurement_category_responsible cr ON cr.category_id = cc.id
       LEFT JOIN users cu ON cu.id = cr.user_id
       LEFT JOIN procurement_substitutions csub
              ON csub.principal_user_id = cr.user_id
             AND csub.ended_at IS NULL
             AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN csub.starts_on AND csub.ends_on
       LEFT JOIN users csu ON csu.id = csub.deputy_user_id
      WHERE cc.is_active = true OR cr.user_id IS NOT NULL
      ORDER BY cc.sort_order, cc.name`,
  );
  return rows;
}

/** Все назначения сотрудника — для модалки «Ответственные» и передачи дел. */
export async function loadUserAssignments(db: Db, userId: string): Promise<{
  categories: unknown[];
  costTypes: unknown[];
  materials: unknown[];
}> {
  const [cats, types, mats] = await Promise.all([
    db.query(
      `SELECT cc.id, cc.name FROM procurement_category_responsible r
         JOIN cost_categories cc ON cc.id = r.category_id
        WHERE r.user_id = $1 ORDER BY cc.sort_order, cc.name`,
      [userId],
    ),
    db.query(
      `SELECT ct.id, ct.name, ct.category_id, cc.name AS category_name
         FROM procurement_cost_type_responsible r
         JOIN cost_types ct ON ct.id = r.cost_type_id
         LEFT JOIN cost_categories cc ON cc.id = ct.category_id
        WHERE r.user_id = $1 ORDER BY cc.sort_order, ct.sort_order, ct.name`,
      [userId],
    ),
    db.query(
      `SELECT r.id, r.agg_key, r.project_id, r.contractor_id, r.cost_type_id,
              p.name AS project_name, o.name AS contractor_name, ct.name AS cost_type_name,
              -- Имя материала берём из последней заявки с тем же ключом: сама область его
              -- не хранит (agg_key — свёртка «материал+единица»).
              (SELECT mri.material_name FROM material_request_items mri
                WHERE mri.agg_key = r.agg_key ORDER BY mri.id LIMIT 1) AS material_name
         FROM procurement_material_responsible r
         LEFT JOIN projects p       ON p.id = r.project_id
         LEFT JOIN organizations o  ON o.id = r.contractor_id
         LEFT JOIN cost_types ct    ON ct.id = r.cost_type_id
        WHERE r.user_id = $1
        ORDER BY p.name NULLS LAST, o.name NULLS LAST, ct.name NULLS LAST`,
      [userId],
    ),
  ]);
  return { categories: cats.rows, costTypes: types.rows, materials: mats.rows };
}
