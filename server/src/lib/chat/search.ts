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
import { simExpr } from './sql.js';
import { findWorkDuplicate, findMaterialDuplicate } from './duplicates.js';
import { getTypicalMaterials } from './typical.js';
import type { AgentContext, Queryable } from './types.js';

const SIM_THRESHOLD = 0.15;
const PREFILTER_LIMIT = 300;

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
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select},
           GREATEST(
             similarity(${simExpr('rv.name')}, ${simExpr('$1')}),
             COALESCE((SELECT MAX(similarity(${simExpr('a')}, ${simExpr('$1')}))
                       FROM jsonb_array_elements_text(rv.aliases) a), 0)
           ) AS sim
         ${from}
         WHERE ${where}
       ) t WHERE t.sim >= $3 ORDER BY t.sim DESC LIMIT $4`,
      [query, costTypeId, SIM_THRESHOLD, limit],
    );
    return rows.map(mapWorkRow('v2'));
  }

  const { rows } = await ctx.db.query(
    `SELECT ${select}, rv.aliases ${from} WHERE ${where}`,
    [query, costTypeId],
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
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select}, similarity(${simExpr('r.name')}, ${simExpr('$1')}) AS sim
         ${from} WHERE ${where}
       ) t WHERE t.sim >= $3 ORDER BY t.sim DESC LIMIT $4`,
      [query, costTypeId, SIM_THRESHOLD, limit],
    );
    return rows.map(mapWorkRow('legacy'));
  }

  const { rows } = await ctx.db.query(`SELECT ${select} ${from} WHERE ${where}`, [query, costTypeId]);
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
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select},
           GREATEST(
             similarity(${simExpr('mv.name')}, ${simExpr('$1')}),
             COALESCE((SELECT MAX(similarity(${simExpr('a')}, ${simExpr('$1')}))
                       FROM jsonb_array_elements_text(mv.aliases) a), 0)
           ) AS sim
         ${from} WHERE ${where}
       ) t WHERE t.sim >= $2 ORDER BY t.sim DESC LIMIT $3`,
      [query, SIM_THRESHOLD, limit],
    );
    return rows.map(mapMaterialRow('v2'));
  }
  const { rows } = await ctx.db.query(`SELECT ${select}, mv.aliases ${from} WHERE ${where}`, [query]);
  return rescoreMaterials(rows, query, 'v2', limit);
}

async function searchMaterialsLegacy(ctx: AgentContext, query: string, limit: number): Promise<MaterialRow[]> {
  const select = `id AS catalog_id, id AS apply_material_id, name, unit, unit_price AS price`;
  if (ctx.hasTrgm) {
    const { rows } = await ctx.db.query(
      `SELECT * FROM (
         SELECT ${select}, similarity(${simExpr('name')}, ${simExpr('$1')}) AS sim
         FROM material_catalog WHERE is_active = true
       ) t WHERE t.sim >= $2 ORDER BY t.sim DESC LIMIT $3`,
      [query, SIM_THRESHOLD, limit],
    );
    return rows.map(mapMaterialRow('legacy'));
  }
  const { rows } = await ctx.db.query(
    `SELECT ${select} FROM material_catalog WHERE is_active = true`,
    [query],
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
