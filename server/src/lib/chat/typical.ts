/**
 * Типовые материалы расценки — для legacy (rate_materials) и v2 (rate_materials_v2).
 * Используется в карточках кандидатов и при добавлении работы с флагом
 * addTypicalMaterials.
 */
import type { CatalogSourceKind } from '@estimat/shared';
import type { Queryable } from './types.js';

export interface TypicalMaterial {
  source: CatalogSourceKind;
  /** id в справочнике материалов (material_catalog.id или materials_v2.id). */
  catalogId: string;
  /** legacy material_id для вставки (может быть null для v2 без legacy). */
  applyMaterialId: string | null;
  name: string;
  unit: string | null;
  price: number;
  qtyRatio: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getTypicalMaterials(
  db: Queryable,
  source: CatalogSourceKind,
  catalogId: string,
): Promise<TypicalMaterial[]> {
  if (source === 'legacy') {
    const { rows } = await db.query(
      `SELECT mc.id, mc.name, mc.unit, mc.unit_price AS price, rm.qty_ratio
       FROM rate_materials rm
       JOIN material_catalog mc ON mc.id = rm.material_id
       WHERE rm.rate_id = $1 AND mc.is_active = true
       ORDER BY rm.sort_order`,
      [catalogId],
    );
    return rows.map((r) => ({
      source: 'legacy' as const,
      catalogId: r.id,
      applyMaterialId: r.id,
      name: r.name,
      unit: r.unit,
      price: num(r.price),
      qtyRatio: num(r.qty_ratio),
    }));
  }

  const { rows } = await db.query(
    `SELECT mv.id, mv.name, mv.unit, mv.legacy_material_id,
            mc.unit_price AS price, rm.qty_ratio
     FROM rate_materials_v2 rm
     JOIN materials_v2 mv ON mv.id = rm.material_v2_id
     LEFT JOIN material_catalog mc ON mc.id = mv.legacy_material_id
     WHERE rm.rate_v2_id = $1 AND mv.is_active = true
     ORDER BY rm.sort_order`,
    [catalogId],
  );
  return rows.map((r) => ({
    source: 'v2' as const,
    catalogId: r.id,
    applyMaterialId: r.legacy_material_id ?? null,
    name: r.name,
    unit: r.unit,
    price: num(r.price),
    qtyRatio: num(r.qty_ratio),
  }));
}
