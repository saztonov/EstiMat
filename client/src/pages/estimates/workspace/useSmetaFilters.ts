import { useMemo, useState } from 'react';
import type { CostTypeGroup, EstimateItem } from '../components/types';
import { parseFloors } from '../components/location';
import { useLocationContextStore } from '../../../store/locationContextStore';

// Ключ секции «Без категории» (общий для фильтров, секций и поэтапного сворачивания).
export const NO_CATEGORY = '__none__';

// Срез локационного фильтра (снимок значений store) для workMatchesLocation.
export interface LocationFilter {
  zoneIds: string[];
  floors: number[];
  locationTypeIds: string[];
  volumeType: 'all' | 'main' | 'additional';
}

// Проходит ли работа фильтр локации (срезы по зоне/набору этажей/типу/объёму). Мультизона:
// достаточно совпадения хотя бы одной зоны и пересечения хотя бы одного этажа.
// Чистая модульная функция — все входы передаются явно (они же в deps visibleGroups).
export function workMatchesLocation(w: EstimateItem, f: LocationFilter): boolean {
  const locs = w.locations ?? [];
  const zoneIds = locs.length
    ? locs.map((l) => l.zoneId).filter((z): z is string => !!z)
    : w.zone_id ? [w.zone_id] : [];
  if (f.zoneIds.length && !zoneIds.some((z) => f.zoneIds.includes(z))) return false;
  if (f.floors.length) {
    let floors: number[];
    if (locs.length) {
      floors = locs.flatMap((l) => l.floors ?? []);
    } else {
      floors = [];
      const from = w.floor_from ?? null;
      const to = w.floor_to ?? null;
      if (from != null && to != null) { for (let x = from; x <= to; x++) floors.push(x); }
      else if (from != null) floors.push(from);
      else if (to != null) floors.push(to);
    }
    if (floors.length === 0) return false; // нет этажей — не проходит этажный срез
    const sel = new Set(f.floors);
    if (!floors.some((x) => sel.has(x))) return false; // нет пересечения
  }
  if (f.locationTypeIds.length && !(w.location_type_id && f.locationTypeIds.includes(w.location_type_id)))
    return false;
  if (f.volumeType !== 'all' && (w.volume_type ?? 'main') !== f.volumeType) return false;
  return true;
}

// Фильтры сметы (категория/вид/несогласованные + локационный срез из store) и производные:
// опции отборов, видимые группы, секции по категориям.
// Возвращает СЫРЫЕ store-значения (filterZoneIds и т.п.), не обёрточный объект — они
// референсно стабильны и используются панелью в deps эффекта сброса выделения.
export function useSmetaFilters(groups: CostTypeGroup[]) {
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [onlyUnreconciled, setOnlyUnreconciled] = useState(false);

  // Местоположение: фильтр-срезы из store.
  const filterZoneIds = useLocationContextStore((s) => s.filterZoneIds);
  const filterFloorsText = useLocationContextStore((s) => s.filterFloorsText);
  const filterLocationTypeIds = useLocationContextStore((s) => s.filterLocationTypeIds);
  const filterVolumeType = useLocationContextStore((s) => s.filterVolumeType);

  // Опции отборов — из самих групп (показываем только то, что есть).
  const categoryOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (g.costCategoryId) m.set(g.costCategoryId, g.costCategoryName ?? '—');
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [groups]);

  const typeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      if (categoryFilter && g.costCategoryId !== categoryFilter) continue;
      if (g.costTypeId) m.set(g.costTypeId, g.costTypeName ?? '—');
    }
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [groups, categoryFilter]);

  // Опции отбора по произвольному «типу» строки — из самих работ (показываем только присутствующие).
  const locationTypeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups)
      for (const w of g.works)
        if (w.location_type_id) m.set(w.location_type_id, w.location_type_name ?? '—');
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [groups]);

  // Набор этажей фильтра из сырого текста («2-4, 6, 11-18»).
  const filterFloors = useMemo(() => parseFloors(filterFloorsText), [filterFloorsText]);

  const locationActive =
    filterZoneIds.length > 0 ||
    filterFloors.length > 0 ||
    filterLocationTypeIds.length > 0 ||
    filterVolumeType !== 'all';

  const visibleGroups = useMemo(() => {
    const byFilter = groups.filter(
      (g) =>
        (!categoryFilter || g.costCategoryId === categoryFilter) &&
        (!typeFilter || g.costTypeId === typeFilter),
    );
    if (!onlyUnreconciled && !locationActive) return byFilter;
    // Фильтр на уровне работ: несогласованные и/или срез по локации. Снимок фильтра
    // строится внутри колбэка — deps те же, что и раньше (все входы workMatchesLocation).
    const f: LocationFilter = {
      zoneIds: filterZoneIds,
      floors: filterFloors,
      locationTypeIds: filterLocationTypeIds,
      volumeType: filterVolumeType,
    };
    return byFilter
      .map((g) => ({
        ...g,
        works: g.works.filter(
          (w) => (!onlyUnreconciled || !!w.needs_review) && (!locationActive || workMatchesLocation(w, f)),
        ),
      }))
      .filter((g) => g.works.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, categoryFilter, typeFilter, onlyUnreconciled, filterZoneIds, filterFloors, filterLocationTypeIds, filterVolumeType]);

  // Группировка видимых видов работ по категориям (порядок — как пришли,
  // groups уже отсортированы по категории→виду).
  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { id: string; name: string; groups: CostTypeGroup[] }>();
    for (const g of visibleGroups) {
      const key = g.costCategoryId ?? NO_CATEGORY;
      if (!map.has(key)) {
        map.set(key, { id: key, name: g.costCategoryName ?? 'Без категории', groups: [] });
        order.push(key);
      }
      map.get(key)!.groups.push(g);
    }
    return order.map((k) => map.get(k)!);
  }, [visibleGroups]);

  return {
    categoryFilter, setCategoryFilter,
    typeFilter, setTypeFilter,
    onlyUnreconciled, setOnlyUnreconciled,
    categoryOptions, typeOptions, locationTypeOptions,
    // Сырые store-значения — для deps эффекта сброса выделения в панели.
    filterZoneIds, filterFloorsText, filterLocationTypeIds, filterVolumeType,
    visibleGroups, sections,
  };
}
