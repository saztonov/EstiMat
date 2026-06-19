/**
 * Загрузка среза справочника (CatalogSnapshot) из БД для сопоставления.
 * Адаптер: принимает минимальный Queryable (pg.Pool/Client), не тянет pg в ядро.
 *
 * Режимы (настройка ai_catalog_source):
 *  - v2_first: новый справочник из ВОР (rates_v2/materials_v2) с алиасами; цена
 *    из v2, при отсутствии — из связанной legacy-записи;
 *  - legacy:  старый справочник (rates/material_catalog);
 *  - both:    v2 первыми, затем legacy (matcher предпочтёт v2 при равенстве).
 */
import type { CatalogEntry, CatalogSnapshot, CatalogSourceMode, SectionScope } from './types.js';

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Доп. фильтр расценок по области (scope). Сужает по видам (costTypeIds) либо,
 * если их нет, по разделам (categoryIds; join cost_types). `$1` — единственный
 * параметр запросов-загрузчиков расценок. Без scope — пустой фильтр.
 */
function rateScopeFilter(
  scope: SectionScope | undefined,
  costTypeCol: string,
): { join: string; where: string; values: unknown[] } {
  if (!scope) return { join: '', where: '', values: [] };
  if (scope.costTypeIds.length > 0) {
    return { join: '', where: ` AND ${costTypeCol} = ANY($1)`, values: [scope.costTypeIds] };
  }
  if (scope.categoryIds.length > 0) {
    return {
      join: ` JOIN cost_types ct_scope ON ct_scope.id = ${costTypeCol}`,
      where: ` AND ct_scope.category_id = ANY($1)`,
      values: [scope.categoryIds],
    };
  }
  return { join: '', where: '', values: [] };
}

/** Привести jsonb-aliases (строки или объекты) к массиву строк. */
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

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadV2Rates(db: Queryable, scope?: SectionScope): Promise<CatalogEntry[]> {
  const f = rateScopeFilter(scope, 'rv.cost_type_id');
  const { rows } = await db.query(
    `SELECT rv.id, rv.name, rv.unit, rv.cost_type_id, rv.aliases,
            COALESCE(NULLIF(rv.price, 0), lr.price) AS price
     FROM rates_v2 rv
     LEFT JOIN rates lr ON rv.legacy_rate_id = lr.id${f.join}
     WHERE rv.is_active = true${f.where}`,
    f.values,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    price: num(r.price),
    aliases: parseAliases(r.aliases),
    costTypeId: r.cost_type_id ?? null,
    source: 'v2' as const,
  }));
}

async function loadV2Materials(db: Queryable): Promise<CatalogEntry[]> {
  // В materials_v2 нет цены — берём из связанной legacy-записи material_catalog.
  const { rows } = await db.query(
    `SELECT mv.id, mv.name, mv.unit, mv.cost_type_id, mv.aliases,
            mc.unit_price AS price
     FROM materials_v2 mv
     LEFT JOIN material_catalog mc ON mv.legacy_material_id = mc.id
     WHERE mv.is_active = true`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    price: num(r.price),
    aliases: parseAliases(r.aliases),
    costTypeId: r.cost_type_id ?? null,
    source: 'v2' as const,
  }));
}

async function loadLegacyRates(db: Queryable, scope?: SectionScope): Promise<CatalogEntry[]> {
  const f = rateScopeFilter(scope, 'r.cost_type_id');
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.unit, r.price, r.cost_type_id
     FROM rates r${f.join}
     WHERE r.is_active = true${f.where}`,
    f.values,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    price: num(r.price),
    aliases: [],
    costTypeId: r.cost_type_id ?? null,
    source: 'legacy' as const,
  }));
}

async function loadLegacyMaterials(db: Queryable): Promise<CatalogEntry[]> {
  const { rows } = await db.query(
    `SELECT id, name, unit, unit_price FROM material_catalog WHERE is_active = true`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    price: num(r.unit_price),
    aliases: [],
    costTypeId: null,
    source: 'legacy' as const,
  }));
}

export async function loadCatalogSnapshot(
  db: Queryable,
  mode: CatalogSourceMode,
  scope?: SectionScope,
): Promise<CatalogSnapshot> {
  // Scope сужает ТОЛЬКО расценки (работы). Материалы грузятся целиком — материал
  // может относиться к расценке другого вида; costTypeId используется в матчинге
  // как мягкий приоритет, а не жёсткий фильтр.
  let rates: CatalogEntry[] = [];
  let materials: CatalogEntry[] = [];

  if (mode === 'legacy') {
    rates = await loadLegacyRates(db, scope);
    materials = await loadLegacyMaterials(db);
  } else if (mode === 'v2_first') {
    rates = await loadV2Rates(db, scope);
    materials = await loadV2Materials(db);
  } else {
    // both: v2 первыми (приоритет при равенстве), затем legacy.
    const [v2r, v2m, lr, lm] = await Promise.all([
      loadV2Rates(db, scope),
      loadV2Materials(db),
      loadLegacyRates(db, scope),
      loadLegacyMaterials(db),
    ]);
    rates = [...v2r, ...lr];
    materials = [...v2m, ...lm];
  }

  return { rates, materials, mode };
}
