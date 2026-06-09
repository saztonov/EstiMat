export interface RegistryMaterial {
  id: string;
  item_id: string;
  material_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  material_name: string | null;
}

// Плоская строка реестра (работа с измерениями + вложенные материалы)
export interface EstimateItemRow {
  id: string;
  estimate_id: string;
  project_id: string | null;
  cost_category_id: string | null;
  cost_type_id: string | null;
  rate_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  sort_order: number;
  created_at: string;
  project_code: string | null;
  project_name: string | null;
  cost_category_name: string | null;
  cost_type_name: string | null;
  rate_code: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  materials: RegistryMaterial[];
}

export interface EstimateItemsResponse {
  data: EstimateItemRow[];
  pagination: { page: number; pageSize: number; total: number };
}
