// Атомарная строка материала для показа и заявки.
//
// Инвариант, на котором держится всё остальное: одна строка ↔ ровно один ключ заказа
// (вид работ + свёртка материала). Уровни группировки «Локация» и «Тип работы» НЕ дробят
// строку — она получает составную сигнатуру набора своих локаций и целиком попадает в один
// узел дерева. Иначе один ключ размножился бы по узлам, и «Заказано» (SUM по cost_type_id +
// agg_key, без локационного измерения) пришлось бы показывать N раз.
import { lineKey } from '@estimat/shared';
import type { AggregatedMaterial, MaterialGroup } from '../../estimates/materials/aggregateMaterials';
import type { EstimateItem } from '../../estimates/components/types';
// Локационные утилиты берём из чистого ./location, а не из LocationBadges.tsx (он их только
// реэкспортирует поверх antd): модуль остаётся без React и тестируется в node:test.
import {
  formatFloors,
  locationKey,
  locationParts,
  type LocationSnapshot,
  type ZoneIndex,
} from '../../estimates/components/location';

/** Категория работ: id для стабильного ключа узла, имя для подписи. */
export interface CategoryRef {
  id: string | null;
  name: string | null;
}

/** costTypeId ('' для null) → категория. */
export type CategoryIndex = Map<string, CategoryRef>;

export interface OrderMaterialRow extends AggregatedMaterial {
  /** Ключ заказа/заявки: lineKey(costTypeId, aggKey). Уникален в пределах свода. */
  orderKey: string;
  costTypeId: string | null;
  costTypeName: string | null;
  category: CategoryRef;
  /** Ключ уровня «Локация»: набор геометрий работ-источников, БЕЗ типа (тип — свой уровень). */
  locationSig: string;
  /** Ключ уровня «Тип работы»: набор типов работ-источников. */
  typeSig: string;
  /** Подписи локации для бейджей (зависят от дерева зон, в сигнатуры не входят). */
  zoneNames: string[];
  floorsLabel: string;
  typeLabels: string[];
}

// Геометрическая часть ключа локации. locationKey включает тип (`|t:<id>`), а у нас тип —
// отдельный уровень: без зануления уровень «Тип работы» выродился бы в одного потомка.
const geoKey = (snap: LocationSnapshot): string => locationKey({ ...snap, locationTypeId: null });

/**
 * Категория по виду работ. MaterialGroup несёт только costCategoryName, а одноимённые
 * категории разных id склеились бы в один узел — id берём из строк сметы.
 */
export function buildCategoryIndex(items: EstimateItem[]): CategoryIndex {
  const index: CategoryIndex = new Map();
  for (const it of items) {
    const key = it.cost_type_id ?? '';
    if (!index.has(key)) index.set(key, { id: it.cost_category_id ?? null, name: it.cost_category_name ?? null });
  }
  return index;
}

/** Разложить свод в плоский список атомарных строк. Количества не пересчитываются. */
export function buildOrderRows(
  groups: MaterialGroup[],
  categoryIndex: CategoryIndex,
  zoneIndex: ZoneIndex,
): OrderMaterialRow[] {
  const rows: OrderMaterialRow[] = [];
  for (const g of groups) {
    const category = categoryIndex.get(g.costTypeId ?? '') ?? { id: null, name: g.costCategoryName };
    for (const m of g.materials) rows.push(toOrderRow(m, g, category, zoneIndex));
  }
  return rows;
}

function toOrderRow(
  m: AggregatedMaterial,
  g: MaterialGroup,
  category: CategoryRef,
  zoneIndex: ZoneIndex,
): OrderMaterialRow {
  const geo = new Set<string>();
  const types = new Set<string>();
  const zoneNames = new Set<string>();
  const typeLabels = new Set<string>();
  // Этажи копим числами и форматируем один раз: склейка готовых подписей дала бы «1-4, 2-3».
  const floors: number[] = [];

  for (const occ of m.occurrences) {
    geo.add(geoKey(occ.location));
    types.add(occ.location.locationTypeId ?? '');
    const parts = locationParts(occ.location, zoneIndex);
    for (const z of parts.zoneNames) zoneNames.add(z);
    floors.push(...parts.floors);
    if (parts.typeLabel) typeLabels.add(parts.typeLabel);
  }

  return {
    ...m,
    orderKey: lineKey(g.costTypeId, m.key),
    costTypeId: g.costTypeId,
    costTypeName: g.costTypeName,
    category,
    locationSig: [...geo].sort().join(';'),
    typeSig: [...types].sort().join(';'),
    zoneNames: [...zoneNames],
    floorsLabel: formatFloors(floors),
    typeLabels: [...typeLabels],
  };
}
