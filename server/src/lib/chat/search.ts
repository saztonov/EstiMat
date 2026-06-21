/**
 * Поиск работ/материалов в справочнике и похожих позиций в сметах других
 * объектов. Основной путь — pg_trgm similarity (по lower+ё→е). Если расширение
 * недоступно — деградация: ILIKE-префильтр / полная загрузка + TS-rescoring
 * (trigramSimilarity из extract-ядра).
 */
import type {
  WorkCandidate,
  MaterialCandidate,
  SimilarWork,
  SimilarMaterial,
  CatalogSourceKind,
} from '@estimat/shared';
import { trigramSimilarity, normLoose } from '../extract/normalize.js';
import type { SectionScope } from '../extract/types.js';
import { simExpr } from './sql.js';
import { findWorkDuplicate, findMaterialDuplicate } from './duplicates.js';
import { getTypicalMaterials } from './typical.js';
import type { AgentContext, Queryable } from './types.js';

const SIM_THRESHOLD = 0.15;
const PREFILTER_LIMIT = 300;

// ============================================================
// Область подбора (sectionScope) — фильтр по разделам/видам затрат
// ============================================================

/** Активна ли область подбора (выбран хотя бы раздел или вид). */
export function isScopeActive(scope: SectionScope | undefined): scope is SectionScope {
  return !!scope && (scope.costTypeIds.length > 0 || scope.categoryIds.length > 0);
}

/**
 * Bare-предикат принадлежности колонки вида затрат активной области; ссылается на
 * параметр `$idx` (один массив). `null` — если область пуста. Значение параметра
 * возвращается отдельно (`value`), чтобы один `$idx` можно было переиспользовать в
 * нескольких местах запроса (см. EXISTS у материалов v2).
 */
export function costTypePredicate(
  scope: SectionScope | undefined,
  col: string,
  idx: number,
): { pred: string; value: string[] } | null {
  if (!isScopeActive(scope)) return null;
  if (scope.costTypeIds.length > 0) {
    return { pred: `${col} = ANY($${idx})`, value: scope.costTypeIds };
  }
  return {
    pred: `${col} IN (SELECT id FROM cost_types WHERE category_id = ANY($${idx}))`,
    value: scope.categoryIds,
  };
}

/** ` AND (<predicate>)` для работ (прямой фильтр по cost_type_id) либо `''`. */
function workScopeClause(scope: SectionScope | undefined, col: string, idx: number): { sql: string; values: unknown[] } {
  const p = costTypePredicate(scope, col, idx);
  return p ? { sql: ` AND (${p.pred})`, values: [p.value] } : { sql: '', values: [] };
}

/**
 * Фильтр материалов v2 по области: прямой `mv.cost_type_id` ИЛИ связь с расценкой
 * выбранной области (один материал может быть типовым у работ разных видов, а его
 * `cost_type_id` указывает лишь на первый — см. импортёр). Оба предиката делят `$idx`.
 */
function materialV2ScopeClause(scope: SectionScope | undefined, idx: number): { sql: string; values: unknown[] } {
  const pMv = costTypePredicate(scope, 'mv.cost_type_id', idx);
  if (!pMv) return { sql: '', values: [] };
  const pRv = costTypePredicate(scope, 'rv.cost_type_id', idx)!;
  return {
    sql: ` AND (${pMv.pred} OR EXISTS (
      SELECT 1 FROM rate_materials_v2 rm JOIN rates_v2 rv ON rv.id = rm.rate_v2_id
      WHERE rm.material_v2_id = mv.id AND ${pRv.pred}))`,
    values: [pMv.value],
  };
}

/** Фильтр legacy-материалов (без cost_type) — только через типовые связи с расценками области. */
function materialLegacyScopeClause(scope: SectionScope | undefined, idx: number): { sql: string; values: unknown[] } {
  const p = costTypePredicate(scope, 'r.cost_type_id', idx);
  if (!p) return { sql: '', values: [] };
  return {
    sql: ` AND EXISTS (
      SELECT 1 FROM rate_materials rm JOIN rates r ON r.id = rm.rate_id
      WHERE rm.material_id = material_catalog.id AND ${p.pred})`,
    values: [p.value],
  };
}

/**
 * costTypeId, выбранный LLM, действует только ВНУТРИ активной области:
 *  - область задаёт виды и costTypeId не входит в них → обнулить (ignored);
 *  - область задаёт только разделы → обнулить (фильтр по разделу всё покроет);
 *  - области нет → как есть.
 */
export function normalizeCostTypeIdToScope(
  scope: SectionScope | undefined,
  costTypeId: string | null | undefined,
): { costTypeId: string | null; ignored: boolean } {
  const id = costTypeId ?? null;
  if (!id || !isScopeActive(scope)) return { costTypeId: id, ignored: false };
  if (scope.costTypeIds.length > 0) {
    return scope.costTypeIds.includes(id)
      ? { costTypeId: id, ignored: false }
      : { costTypeId: null, ignored: true };
  }
  return { costTypeId: null, ignored: true };
}

let trgmCache: boolean | null = null;

/** Установлено ли расширение pg_trgm (кэшируется на процесс). */
export async function hasPgTrgm(db: Queryable): Promise<boolean> {
  if (trgmCache !== null) return trgmCache;
  const { rows } = await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
  trgmCache = rows.length > 0;
  return trgmCache;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const a of raw) {
    if (typeof a === 'string') out.push(a);
    else if (a && typeof a === 'object') {
      const v = (a as any).name ?? (a as any).alias ?? (a as any).value;
      if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

function tokens(q: string): string[] {
  return Array.from(new Set(normLoose(q).split(' ').filter((w) => w.length >= 3)));
}

/** ILIKE-условие по списку токенов для колонки (OR). Параметры с индекса startIdx. */
function ilikeClause(col: string, query: string, startIdx: number): { clause: string; values: unknown[] } {
  const tks = tokens(query);
  const list = tks.length > 0 ? tks : [normLoose(query)];
  const conds = list.map((_, i) => `lower(${col}) LIKE '%' || lower($${startIdx + i}) || '%'`);
  return { clause: `(${conds.join(' OR ')})`, values: list };
}

function bestAliasSim(query: string, name: string, aliases: string[]): number {
  let best = trigramSimilarity(query, name);
  for (const a of aliases) best = Math.max(best, trigramSimilarity(query, a));
  return best;
}

// ============================================================
// Работы в справочнике
// ============================================================

interface WorkRow {
  source: CatalogSourceKind;
  catalogId: string;
  applyRateId: string | null;
  name: string;
  costTypeId: string | null;
  categoryName: string | null;
  costTypeName: string | null;
  unit: string | null;
  price: number;
  confidence: number;
}

async function searchWorksV2(
  ctx: AgentContext,
  query: string,
  costTypeId: string | null,
  limit: number,
): Promise<WorkRow[]> {
  const select = `rv.id AS catalog_id, rv.legacy_rate_id AS apply_rate_id, rv.name, rv.unit,
    rv.cost_type_id, ct.name AS cost_type_name, cc.name AS category_name,
    COALESCE(NULLIF(rv.price, 0), lr.price) AS price`;
  const from = `FROM rates_v2 rv
    LEFT JOIN rates lr ON rv.legacy_rate_id = lr.id
    LEFT JOIN cost_types ct ON ct.id = rv.cost_type_id
    LEFT JOIN cost_categories cc ON cc.id = ct.category_id`;
  const where = `rv.is_active = true AND ($2::uuid IS NULL OR rv.cost_type_id = $2)`;

  if (ctx.hasTrgm) {
    const sc = workScopeClause(ctx.sectionScope, 'rv.cost_type_id', 5);
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select},
           GREATEST(
             similarity(${simExpr('rv.name')}, ${simExpr('$1')}),
             COALESCE((SELECT MAX(similarity(${simExpr('a')}, ${simExpr('$1')}))
                       FROM jsonb_array_elements_text(rv.aliases) a), 0)
           ) AS sim
         ${from}
         WHERE ${where}${sc.sql}
       ) t WHERE t.sim >= $3 ORDER BY t.sim DESC LIMIT $4`,
      [query, costTypeId, SIM_THRESHOLD, limit, ...sc.values],
    );
    return rows.map(mapWorkRow('v2'));
  }

  const sc = workScopeClause(ctx.sectionScope, 'rv.cost_type_id', 3);
  const { rows } = await ctx.db.query(
    `SELECT ${select}, rv.aliases ${from} WHERE ${where}${sc.sql}`,
    [query, costTypeId, ...sc.values],
  );
  return rescoreWorks(rows, query, 'v2', limit);
}

async function searchWorksLegacy(
  ctx: AgentContext,
  query: string,
  costTypeId: string | null,
  limit: number,
): Promise<WorkRow[]> {
  const select = `r.id AS catalog_id, r.id AS apply_rate_id, r.name, r.unit,
    r.cost_type_id, ct.name AS cost_type_name, cc.name AS category_name, r.price`;
  const from = `FROM rates r
    LEFT JOIN cost_types ct ON ct.id = r.cost_type_id
    LEFT JOIN cost_categories cc ON cc.id = ct.category_id`;
  const where = `r.is_active = true AND ($2::uuid IS NULL OR r.cost_type_id = $2)`;

  if (ctx.hasTrgm) {
    const sc = workScopeClause(ctx.sectionScope, 'r.cost_type_id', 5);
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select}, similarity(${simExpr('r.name')}, ${simExpr('$1')}) AS sim
         ${from} WHERE ${where}${sc.sql}
       ) t WHERE t.sim >= $3 ORDER BY t.sim DESC LIMIT $4`,
      [query, costTypeId, SIM_THRESHOLD, limit, ...sc.values],
    );
    return rows.map(mapWorkRow('legacy'));
  }

  const sc = workScopeClause(ctx.sectionScope, 'r.cost_type_id', 3);
  const { rows } = await ctx.db.query(`SELECT ${select} ${from} WHERE ${where}${sc.sql}`, [query, costTypeId, ...sc.values]);
  return rescoreWorks(rows, query, 'legacy', limit);
}

function mapWorkRow(source: CatalogSourceKind) {
  return (r: any): WorkRow => ({
    source,
    catalogId: r.catalog_id,
    applyRateId: r.apply_rate_id ?? null,
    name: r.name,
    costTypeId: r.cost_type_id ?? null,
    categoryName: r.category_name ?? null,
    costTypeName: r.cost_type_name ?? null,
    unit: r.unit ?? null,
    price: num(r.price),
    confidence: num(r.sim),
  });
}

function rescoreWorks(rows: any[], query: string, source: CatalogSourceKind, limit: number): WorkRow[] {
  return rows
    .map((r) => {
      const aliases = parseAliases(r.aliases);
      const sim = bestAliasSim(query, r.name, aliases);
      return { ...mapWorkRow(source)({ ...r, sim }), confidence: sim };
    })
    .filter((c) => c.confidence >= SIM_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

export async function searchCatalogWorks(
  ctx: AgentContext,
  opts: { query: string; costTypeId?: string | null; limit?: number },
): Promise<WorkCandidate[]> {
  const limit = Math.min(Math.max(opts.query ? opts.limit ?? 8 : 0, 0), 20);
  const costTypeId = opts.costTypeId ?? null;
  const mode = ctx.catalogMode;

  const rows: WorkRow[] = [];
  if (mode === 'v2_first' || mode === 'both') {
    rows.push(...(await searchWorksV2(ctx, opts.query, costTypeId, limit)));
  }
  if (mode === 'legacy' || mode === 'both') {
    rows.push(...(await searchWorksLegacy(ctx, opts.query, costTypeId, limit)));
  }
  const top = rows.sort((a, b) => b.confidence - a.confidence).slice(0, limit);

  // Обогащение top-N: дубли в смете + число типовых материалов (ограниченно).
  const out: WorkCandidate[] = [];
  for (const c of top) {
    const duplicateOfItemId = await findWorkDuplicate(ctx.db, ctx.estimateId, c.applyRateId, c.name);
    const typical = await getTypicalMaterials(ctx.db, c.source, c.catalogId);
    out.push({ ...c, duplicateOfItemId, typicalMaterialsCount: typical.length });
  }
  return out;
}

// ============================================================
// Материалы в справочнике
// ============================================================

interface MaterialRow {
  source: CatalogSourceKind;
  catalogId: string;
  applyMaterialId: string | null;
  name: string;
  unit: string | null;
  price: number;
  confidence: number;
}

function mapMaterialRow(source: CatalogSourceKind) {
  return (r: any): MaterialRow => ({
    source,
    catalogId: r.catalog_id,
    applyMaterialId: r.apply_material_id ?? null,
    name: r.name,
    unit: r.unit ?? null,
    price: num(r.price),
    confidence: num(r.sim),
  });
}

async function searchMaterialsV2(ctx: AgentContext, query: string, limit: number): Promise<MaterialRow[]> {
  const select = `mv.id AS catalog_id, mv.legacy_material_id AS apply_material_id, mv.name, mv.unit,
    mc.unit_price AS price`;
  const from = `FROM materials_v2 mv LEFT JOIN material_catalog mc ON mc.id = mv.legacy_material_id`;
  const where = `mv.is_active = true`;
  if (ctx.hasTrgm) {
    const sc = materialV2ScopeClause(ctx.sectionScope, 4);
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select},
           GREATEST(
             similarity(${simExpr('mv.name')}, ${simExpr('$1')}),
             COALESCE((SELECT MAX(similarity(${simExpr('a')}, ${simExpr('$1')}))
                       FROM jsonb_array_elements_text(mv.aliases) a), 0)
           ) AS sim
         ${from} WHERE ${where}${sc.sql}
       ) t WHERE t.sim >= $2 ORDER BY t.sim DESC LIMIT $3`,
      [query, SIM_THRESHOLD, limit, ...sc.values],
    );
    return rows.map(mapMaterialRow('v2'));
  }
  const sc = materialV2ScopeClause(ctx.sectionScope, 2);
  const { rows } = await ctx.db.query(`SELECT ${select}, mv.aliases ${from} WHERE ${where}${sc.sql}`, [query, ...sc.values]);
  return rescoreMaterials(rows, query, 'v2', limit);
}

async function searchMaterialsLegacy(ctx: AgentContext, query: string, limit: number): Promise<MaterialRow[]> {
  const select = `id AS catalog_id, id AS apply_material_id, name, unit, unit_price AS price`;
  if (ctx.hasTrgm) {
    const sc = materialLegacyScopeClause(ctx.sectionScope, 4);
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select}, similarity(${simExpr('name')}, ${simExpr('$1')}) AS sim
         FROM material_catalog WHERE is_active = true${sc.sql}
       ) t WHERE t.sim >= $2 ORDER BY t.sim DESC LIMIT $3`,
      [query, SIM_THRESHOLD, limit, ...sc.values],
    );
    return rows.map(mapMaterialRow('legacy'));
  }
  const sc = materialLegacyScopeClause(ctx.sectionScope, 2);
  const { rows } = await ctx.db.query(
    `SELECT ${select} FROM material_catalog WHERE is_active = true${sc.sql}`,
    [query, ...sc.values],
  );
  return rescoreMaterials(rows, query, 'legacy', limit);
}

function rescoreMaterials(rows: any[], query: string, source: CatalogSourceKind, limit: number): MaterialRow[] {
  return rows
    .map((r) => {
      const sim = bestAliasSim(query, r.name, parseAliases(r.aliases));
      return { ...mapMaterialRow(source)({ ...r, sim }), confidence: sim };
    })
    .filter((c) => c.confidence >= SIM_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

export async function searchCatalogMaterials(
  ctx: AgentContext,
  opts: { query: string; limit?: number },
): Promise<MaterialCandidate[]> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 0), 20);
  const mode = ctx.catalogMode;

  const rows: MaterialRow[] = [];
  if (mode === 'v2_first' || mode === 'both') rows.push(...(await searchMaterialsV2(ctx, opts.query, limit)));
  if (mode === 'legacy' || mode === 'both') rows.push(...(await searchMaterialsLegacy(ctx, opts.query, limit)));
  const top = rows.sort((a, b) => b.confidence - a.confidence).slice(0, limit);

  const out: MaterialCandidate[] = [];
  for (const c of top) {
    const duplicateOfItemId = await findMaterialDuplicate(ctx.db, ctx.estimateId, c.applyMaterialId, c.name);
    out.push({ ...c, duplicateOfItemId });
  }
  return out;
}

// ============================================================
// Похожие позиции в сметах других объектов
// ============================================================

type SimilarScope = 'other_projects' | 'this_project' | 'all';

function scopeClause(scope: SimilarScope, projParam: string): string {
  if (scope === 'this_project') return `e.project_id = ${projParam}`;
  if (scope === 'all') return 'TRUE';
  return `e.project_id <> ${projParam}`;
}

export async function searchSimilarWorks(
  ctx: AgentContext,
  opts: { query: string; scope?: SimilarScope; limit?: number },
): Promise<SimilarWork[]> {
  const scope = opts.scope ?? 'other_projects';
  const limit = Math.min(Math.max(opts.limit ?? 8, 0), 20);
  const isAdmin = ctx.user.role === 'admin';

  // Параметры: $1 query, $2 projectId, [orgId,userId если не admin], threshold/prefilter, limit
  const accessParams: unknown[] = isAdmin ? [] : [ctx.user.orgId, ctx.user.id];
  const accessClause = isAdmin
    ? 'TRUE'
    : `(p.org_id = $3 OR p.id IN (SELECT project_id FROM project_members WHERE user_id = $4))`;
  const sc = scopeClause(scope, '$2');

  if (ctx.hasTrgm) {
    const thIdx = 3 + accessParams.length;
    const limIdx = thIdx + 1;
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ei.description, ei.quantity, ei.unit, ei.unit_price, ei.rate_id,
                p.code AS project_code, p.name AS project_name, e.id AS estimate_id,
                similarity(${simExpr('ei.description')}, ${simExpr('$1')}) AS sim
         FROM estimate_items ei
         JOIN estimates e ON e.id = ei.estimate_id
         JOIN projects p ON p.id = e.project_id
         WHERE ${sc} AND ${accessClause}
       ) t WHERE t.sim >= $${thIdx} ORDER BY t.sim DESC LIMIT $${limIdx}`,
      [opts.query, ctx.projectId, ...accessParams, SIM_THRESHOLD, limit],
    );
    return rows.map(mapSimilarWork);
  }

  // Fallback: ILIKE-префильтр + TS-rescore.
  const il = ilikeClause('ei.description', opts.query, 3 + accessParams.length);
  const { rows } = await ctx.db.query(
    `SELECT ei.description, ei.quantity, ei.unit, ei.unit_price, ei.rate_id,
            p.code AS project_code, p.name AS project_name, e.id AS estimate_id
     FROM estimate_items ei
     JOIN estimates e ON e.id = ei.estimate_id
     JOIN projects p ON p.id = e.project_id
     WHERE ${sc} AND ${accessClause} AND ${il.clause}
     LIMIT ${PREFILTER_LIMIT}`,
    [opts.query, ctx.projectId, ...accessParams, ...il.values],
  );
  return rows
    .map((r) => ({ r, sim: trigramSimilarity(opts.query, r.description) }))
    .filter((x) => x.sim >= SIM_THRESHOLD)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit)
    .map((x) => mapSimilarWork({ ...x.r, sim: x.sim }));
}

function mapSimilarWork(r: any): SimilarWork {
  return {
    description: r.description,
    quantity: num(r.quantity),
    unit: r.unit ?? null,
    unitPrice: num(r.unit_price),
    rateId: r.rate_id ?? null,
    projectCode: r.project_code ?? null,
    projectName: r.project_name ?? null,
    estimateId: r.estimate_id,
    similarity: num(r.sim),
  };
}

export async function searchSimilarMaterials(
  ctx: AgentContext,
  opts: { query: string; scope?: SimilarScope; limit?: number },
): Promise<SimilarMaterial[]> {
  const scope = opts.scope ?? 'other_projects';
  const limit = Math.min(Math.max(opts.limit ?? 8, 0), 20);
  const isAdmin = ctx.user.role === 'admin';
  const accessParams: unknown[] = isAdmin ? [] : [ctx.user.orgId, ctx.user.id];
  const accessClause = isAdmin
    ? 'TRUE'
    : `(p.org_id = $3 OR p.id IN (SELECT project_id FROM project_members WHERE user_id = $4))`;
  const sc = scopeClause(scope, '$2');

  if (ctx.hasTrgm) {
    const thIdx = 3 + accessParams.length;
    const limIdx = thIdx + 1;
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT em.description, em.quantity, em.unit, em.unit_price, em.material_id,
                pi.description AS parent_work, p.code AS project_code, p.name AS project_name,
                e.id AS estimate_id,
                similarity(${simExpr('em.description')}, ${simExpr('$1')}) AS sim
         FROM estimate_materials em
         JOIN estimates e ON e.id = em.estimate_id
         JOIN projects p ON p.id = e.project_id
         LEFT JOIN estimate_items pi ON pi.id = em.item_id
         WHERE ${sc} AND ${accessClause}
       ) t WHERE t.sim >= $${thIdx} ORDER BY t.sim DESC LIMIT $${limIdx}`,
      [opts.query, ctx.projectId, ...accessParams, SIM_THRESHOLD, limit],
    );
    return rows.map(mapSimilarMaterial);
  }

  const il = ilikeClause('em.description', opts.query, 3 + accessParams.length);
  const { rows } = await ctx.db.query(
    `SELECT em.description, em.quantity, em.unit, em.unit_price, em.material_id,
            pi.description AS parent_work, p.code AS project_code, p.name AS project_name,
            e.id AS estimate_id
     FROM estimate_materials em
     JOIN estimates e ON e.id = em.estimate_id
     JOIN projects p ON p.id = e.project_id
     LEFT JOIN estimate_items pi ON pi.id = em.item_id
     WHERE ${sc} AND ${accessClause} AND ${il.clause}
     LIMIT ${PREFILTER_LIMIT}`,
    [opts.query, ctx.projectId, ...accessParams, ...il.values],
  );
  return rows
    .map((r) => ({ r, sim: trigramSimilarity(opts.query, r.description) }))
    .filter((x) => x.sim >= SIM_THRESHOLD)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit)
    .map((x) => mapSimilarMaterial({ ...x.r, sim: x.sim }));
}

function mapSimilarMaterial(r: any): SimilarMaterial {
  return {
    description: r.description,
    quantity: num(r.quantity),
    unit: r.unit ?? null,
    unitPrice: num(r.unit_price),
    materialId: r.material_id ?? null,
    parentWorkDescription: r.parent_work ?? null,
    projectCode: r.project_code ?? null,
    projectName: r.project_name ?? null,
    estimateId: r.estimate_id,
    similarity: num(r.sim),
  };
}
