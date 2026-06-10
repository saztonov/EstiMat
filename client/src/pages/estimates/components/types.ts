export interface EstimateMaterial {
  id: string;
  item_id: string;
  material_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  sort_order?: number;
  material_name: string | null;
}

// Строка сметы = работа. Несёт измерения (объект/категория/вид затрат)
// и список материалов под ней.
export interface EstimateItem {
  id: string;
  estimate_id: string;
  project_id?: string | null;
  cost_category_id: string | null;
  cost_category_name?: string | null;
  cost_type_id: string | null;
  cost_type_name?: string | null;
  rate_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  sort_order: number;
  rate_name: string | null;
  rate_code: string | null;
  materials: EstimateMaterial[];
}

// Подрядчик на вид затрат (estimate + cost_type)
export interface EstimateContractor {
  cost_type_id: string;
  contractor_id: string;
  contractor_name: string | null;
  cost_type_name?: string | null;
  cost_category_id?: string | null;
  cost_category_name?: string | null;
}

export interface EstimateDetail {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  cost_category_id: string | null;
  cost_category_name: string | null;
  work_type: string | null;
  total_amount: string;
  notes: string | null;
  items: EstimateItem[];
  contractors: EstimateContractor[];
}

// Группа строк по виду затрат (строится на клиенте из items/contractors)
export interface CostTypeGroup {
  costTypeId: string | null;
  costTypeName: string | null;
  costCategoryId: string | null;
  costCategoryName: string | null;
  works: EstimateItem[];
  contractor: EstimateContractor | null;
}

export const formatMoney = (v: string | number | null | undefined) =>
  `${Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

const GROUP_NONE = '__none__';

// Сгруппировать работы по виду затрат, домешав подрядчиков и «отложенные»
// (добавленные в UI, ещё без работ) виды затрат. Сортировка по категории/виду.
export function buildCostTypeGroups(
  items: EstimateItem[],
  contractors: EstimateContractor[],
  pending: CostTypeGroup[] = [],
): CostTypeGroup[] {
  const map = new Map<string, CostTypeGroup>();
  const keyOf = (id: string | null) => id ?? GROUP_NONE;

  const ensure = (id: string | null): CostTypeGroup => {
    const k = keyOf(id);
    let g = map.get(k);
    if (!g) {
      g = {
        costTypeId: id,
        costTypeName: null,
        costCategoryId: null,
        costCategoryName: null,
        works: [],
        contractor: null,
      };
      map.set(k, g);
    }
    return g;
  };

  for (const it of items) {
    const g = ensure(it.cost_type_id);
    g.costTypeName ??= it.cost_type_name ?? null;
    g.costCategoryId ??= it.cost_category_id ?? null;
    g.costCategoryName ??= it.cost_category_name ?? null;
    g.works.push(it);
  }

  for (const p of pending) {
    const g = ensure(p.costTypeId);
    g.costTypeName ??= p.costTypeName;
    g.costCategoryId ??= p.costCategoryId;
    g.costCategoryName ??= p.costCategoryName;
  }

  for (const c of contractors) {
    const g = ensure(c.cost_type_id);
    g.contractor = c;
    g.costTypeName ??= c.cost_type_name ?? null;
    g.costCategoryId ??= c.cost_category_id ?? null;
    g.costCategoryName ??= c.cost_category_name ?? null;
  }

  return [...map.values()].sort((a, b) => {
    const ca = (a.costCategoryName ?? '').localeCompare(b.costCategoryName ?? '', 'ru');
    if (ca !== 0) return ca;
    return (a.costTypeName ?? '').localeCompare(b.costTypeName ?? '', 'ru');
  });
}
