// ---- Дерево расценок из GET /api/rates/tree ----
export interface RateTreeRate {
  id: string;
  cost_type_id: string;
  name: string;
  code: string | null;
  unit: string;
  price: string;
  description?: string | null;
  is_active?: boolean;
  type_count?: number; // число видов, к которым привязана работа (для «(N)» в дереве)
}
export interface RateTreeType {
  id: string;
  category_id: string;
  name: string;
  code: string | null;
  sort_order?: number;
  rates: RateTreeRate[];
}
export interface RateTreeCategory {
  id: string;
  name: string;
  code: string | null;
  sort_order?: number;
  types: RateTreeType[];
}

// Полезная нагрузка листа дерева работ — для добавления работы в смету
export interface RateLeafPayload {
  rateId: string;
  costTypeId: string;
  costTypeName: string;
  costCategoryId: string;
  costCategoryName: string;
  name: string; // готовое наименование (с кодом, если есть)
  code: string | null;
  unit: string;
  price: number;
  typeCount: number; // число видов работы (для отображения «(N)» в дереве)
}

// ---- Справочник материалов ----
export interface MaterialRef {
  id: string;
  name: string;
  group_id: string | null;
  group_name?: string | null;
  unit: string;
  unit_price: string;
}
export interface MaterialGroupRef {
  id: string;
  name: string;
  parent_id: string | null;
  code: string | null;
}

// Дерево справочника материалов: Категория → Вид работ → Материалы (по material_groups.parent_id).
export interface MaterialGroupNode {
  id: string;
  name: string;
  parent_id: string | null;
  code: string | null;
  children: MaterialGroupNode[];
  materials: MaterialRef[];
}
export interface MaterialsTree {
  roots: MaterialGroupNode[];
  ungrouped: MaterialRef[];
}
