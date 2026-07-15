import { useCallback, useMemo, useState } from 'react';
import type { EstimateItem } from '../estimates/components/types';
import { parseFloors } from '../estimates/components/location';
import { workMatchesLocation, type LocationFilter } from '../estimates/workspace/useSmetaFilters';
import { EMPTY_LOCATION_FILTER, type LocationFilterValue } from '../estimates/workspace/LocationFilterPopover';

// Локационный отбор раздела «Подрядчики»: корпус/зона, этажи, тип. Состояние — локальное и своё
// на каждую вкладку: глобальный store фильтра принадлежит странице «Смета», и делить его нельзя
// (отбор в одном разделе не должен менять выдачу в другом). «Осн/Доп» здесь не используется —
// volumeType остаётся 'all' и секция скрыта.
export function useContractorLocationFilter(items: EstimateItem[]) {
  const [value, setValue] = useState<LocationFilterValue>(EMPTY_LOCATION_FILTER);

  const onChange = useCallback((patch: Partial<LocationFilterValue>) => {
    setValue((prev) => ({ ...prev, ...patch }));
  }, []);
  const clear = useCallback(() => setValue(EMPTY_LOCATION_FILTER), []);

  // Опции отбора по типу — из самих строк (показываем только присутствующие).
  const typeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) if (it.location_type_id) m.set(it.location_type_id, it.location_type_name ?? '—');
    return [...m.entries()]
      .map(([v, label]) => ({ value: v, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [items]);

  const floors = useMemo(() => parseFloors(value.floorsText), [value.floorsText]);
  const active = value.zoneIds.length > 0 || floors.length > 0 || value.locationTypeIds.length > 0;

  const filterItems = useCallback(
    (src: EstimateItem[]) => {
      if (!active) return src;
      const f: LocationFilter = {
        zoneIds: value.zoneIds,
        floors,
        locationTypeIds: value.locationTypeIds,
        volumeType: 'all',
      };
      return src.filter((w) => workMatchesLocation(w, f));
    },
    [active, value.zoneIds, value.locationTypeIds, floors],
  );

  return { value, onChange, clear, typeOptions, active, filterItems };
}
