import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Ось группировки таблицы сметы.
export type LocationGroupBy = 'cost_type' | 'location' | 'location_cost_type';

// Контекст добавления — одна точная локация, куда падают новые работы.
// Тип помещения временно скрыт во всём локационном UX (roomTypeId не задаётся).
export interface LocationAddContext {
  zoneId: string | null;
  floorFrom: number | null;
  floorTo: number | null;
}

export const EMPTY_ADD_CONTEXT: LocationAddContext = {
  zoneId: null,
  floorFrom: null,
  floorTo: null,
};

interface LocationContextState {
  // Контекст ДОБАВЛЕНИЯ (персистится per-estimate): куда падают новые работы.
  byEstimate: Record<string, LocationAddContext>;
  setAddContext: (estimateId: string, ctx: LocationAddContext) => void;
  clearAddContext: (estimateId: string) => void;

  // ФИЛЬТР отображения (транзиент, НЕ персистится): срезы по локации.
  filterZoneIds: string[];
  filterFloorFrom: number | null;
  filterFloorTo: number | null;
  setFilter: (f: Partial<Pick<LocationContextState,
    'filterZoneIds' | 'filterFloorFrom' | 'filterFloorTo'>>) => void;
  clearFilter: () => void;

  // Ось группировки (транзиент).
  groupBy: LocationGroupBy;
  setGroupBy: (g: LocationGroupBy) => void;
}

export const useLocationContextStore = create<LocationContextState>()(
  persist(
    (set) => ({
      byEstimate: {},
      setAddContext: (estimateId, ctx) =>
        set((s) => ({ byEstimate: { ...s.byEstimate, [estimateId]: ctx } })),
      clearAddContext: (estimateId) =>
        set((s) => ({ byEstimate: { ...s.byEstimate, [estimateId]: EMPTY_ADD_CONTEXT } })),

      filterZoneIds: [],
      filterFloorFrom: null,
      filterFloorTo: null,
      setFilter: (f) => set((s) => ({ ...s, ...f })),
      clearFilter: () =>
        set({ filterZoneIds: [], filterFloorFrom: null, filterFloorTo: null }),

      groupBy: 'cost_type',
      setGroupBy: (groupBy) => set({ groupBy }),
    }),
    {
      name: 'estimat:loc-ctx',
      version: 1,
      // Персистим только контекст добавления; фильтр и группировка — транзиентные.
      partialize: (s) => ({ byEstimate: s.byEstimate }),
    },
  ),
);

// Хелпер: контекст добавления для сметы (с дефолтом).
export function useAddContext(estimateId: string): LocationAddContext {
  return useLocationContextStore((s) => s.byEstimate[estimateId] ?? EMPTY_ADD_CONTEXT);
}
