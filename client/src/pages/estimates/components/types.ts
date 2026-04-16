export interface EstimateItem {
  id: string;
  section_id: string | null;
  item_type: 'work' | 'material';
  rate_id: string | null;
  material_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  sort_order: number;
  rate_name: string | null;
  rate_code: string | null;
  material_name: string | null;
}

export interface EstimateSection {
  id: string;
  estimate_id: string;
  cost_type_id: string | null;
  cost_type_name: string | null;
  cost_category_id: string | null;
  cost_category_name: string | null;
  name: string;
  sort_order: number;
  items: EstimateItem[];
}

export interface EstimateDetail {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  contractor_name: string | null;
  work_type: string | null;
  status: string;
  total_amount: string;
  notes: string | null;
  sections: EstimateSection[];
  items: EstimateItem[];
}

export const formatMoney = (v: string | number | null | undefined) =>
  `${Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
