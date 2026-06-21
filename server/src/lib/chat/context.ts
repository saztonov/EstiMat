/** Чтение контекста: состав текущей сметы и дерево справочника (виды затрат). */
import type { Queryable } from './types.js';

export interface EstimateContextItem {
  itemId: string;
  description: string;
  quantity: number;
  unit: string | null;
  costTypeName: string | null;
  needsReview: boolean;
  materialsCount: number;
}

export interface EstimateContext {
  estimateId: string;
  projectName: string | null;
  totalItems: number;
  items: EstimateContextItem[];
}

export async function getEstimateContext(db: Queryable, estimateId: string): Promise<EstimateContext> {
  const head = await db.query(
    `SELECT p.name AS project_name FROM estimates e JOIN projects p ON p.id = e.project_id WHERE e.id = $1`,
    [estimateId],
  );
  const { rows } = await db.query(
    `SELECT ei.id, ei.description, ei.quantity, ei.unit, ei.needs_review,
            ct.name AS cost_type_name,
            (SELECT count(*) FROM estimate_materials em WHERE em.item_id = ei.id) AS materials_count
     FROM estimate_items ei
     LEFT JOIN cost_types ct ON ct.id = ei.cost_type_id
     WHERE ei.estimate_id = $1
     ORDER BY ei.sort_order, ei.created_at`,
    [estimateId],
  );
  return {
    estimateId,
    projectName: head.rows[0]?.project_name ?? null,
    totalItems: rows.length,
    items: rows.map((r) => ({
      itemId: r.id,
      description: r.description,
      quantity: Number(r.quantity) || 0,
      unit: r.unit ?? null,
      costTypeName: r.cost_type_name ?? null,
      needsReview: r.needs_review === true,
      materialsCount: Number(r.materials_count) || 0,
    })),
  };
}

export interface CostCategoryNode {
  categoryId: string;
  categoryName: string;
  types: { costTypeId: string; costTypeName: string }[];
}

export async function listCostCategories(db: Queryable): Promise<CostCategoryNode[]> {
  const { rows } = await db.query(
    `SELECT cc.id AS category_id, cc.name AS category_name,
            ct.id AS cost_type_id, ct.name AS cost_type_name
     FROM cost_categories cc
     JOIN cost_types ct ON ct.category_id = cc.id
     ORDER BY cc.sort_order, cc.name, ct.sort_order, ct.name`,
  );
  const map = new Map<string, CostCategoryNode>();
  for (const r of rows) {
    let node = map.get(r.category_id);
    if (!node) {
      node = { categoryId: r.category_id, categoryName: r.category_name, types: [] };
      map.set(r.category_id, node);
    }
    node.types.push({ costTypeId: r.cost_type_id, costTypeName: r.cost_type_name });
  }
  return Array.from(map.values());
}

/** Превью раздела для копирования (read-only): работы вида затрат из сметы-источника. */
export async function previewSection(
  db: Queryable,
  sourceEstimateId: string,
  costTypeId: string,
  limit = 100,
): Promise<{ description: string; quantity: number; unit: string | null; unitPrice: number; estimateId: string }[]> {
  const { rows } = await db.query(
    `SELECT description, quantity, unit, unit_price
     FROM estimate_items
     WHERE estimate_id = $1 AND cost_type_id = $2
     ORDER BY sort_order, created_at LIMIT $3`,
    [sourceEstimateId, costTypeId, limit],
  );
  return rows.map((r) => ({
    description: r.description,
    quantity: Number(r.quantity) || 0,
    unit: r.unit ?? null,
    unitPrice: Number(r.unit_price) || 0,
    estimateId: sourceEstimateId,
  }));
}
