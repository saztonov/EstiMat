import type { LocationEntry } from './location';

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
  /** 'suggested' — добавлен автоматически по типовому набору расценки («предложение»),
   *  требует подтверждения ✓ или удаления ✗; 'confirmed' — подтверждён. */
  status: 'suggested' | 'confirmed';
  /** Источник: 'manual' | 'ai' | 'catalog' (трассировка ИИ-извлечения). */
  source?: 'manual' | 'ai' | 'catalog';
  needs_review?: boolean;
  confidence?: string | number | null;
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
  /** Источник: 'manual' | 'ai' | 'catalog' (трассировка ИИ-извлечения). */
  source?: 'manual' | 'ai' | 'catalog';
  needs_review?: boolean;
  confidence?: string | number | null;
  // Мультилокация (источник истины): зоны + точный набор этажей.
  locations?: LocationEntry[] | null;
  // Легаси «первичное» зеркало (зона + диапазон этажей) + тип помещения (денормализованные имена).
  zone_id?: string | null;
  zone_name?: string | null;
  zone_kind?: string | null;
  floor_from?: number | null;
  floor_to?: number | null;
  room_type_id?: string | null;
  room_type_name?: string | null;
  // Трассировка тиражирования.
  copy_batch_id?: string | null;
  copy_source_item_id?: string | null;
  // Назначения подрядчиков на строку + распределение объёма (раздел «Подрядчики», вид инженера).
  item_contractors?: ItemContractor[];
  assigned_total?: number;
  remaining_qty?: number;
  over_assigned?: boolean;
  // Вид подрядчика (его строки из /contractors/my-items): объём, назначенный его организации.
  my_effective_qty?: string | number | null;
  my_assigned_qty?: string | null;
  my_assigned_percent?: string | null;
}

// Назначение подрядчика (организации) на строку сметы с распределённым объёмом.
export interface ItemContractor {
  item_id?: string;
  contractor_id: string;
  contractor_name: string | null;
  assigned_qty: string | null;
  assigned_percent: string | null;
  /** Эффективный объём подрядчика по строке (qty, доля или весь объём) — посчитан сервером. */
  effective_qty: string | number;
}

/** Есть ли в работе несогласованные позиции (сама работа или её материалы). */
export function hasUnreconciled(item: EstimateItem): boolean {
  return !!item.needs_review || item.materials.some((m) => m.needs_review);
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
