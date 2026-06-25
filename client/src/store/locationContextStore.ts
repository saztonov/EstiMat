import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

  // Флаг «добавлять в указанное местоположение» (персистится per-estimate):
  // применять контекст добавления к новым работам только когда true.
  addEnabled: Record<string, boolean>;
  setAddEnabled: (estimateId: string, enabled: boolean) => void;

  // ФИЛЬТР отображения (транзиент, НЕ персистится): срезы по местоположению.
  filterZoneIds: string[];
  filterFloorFrom: number | null;
  filterFloorTo: number | null;
  setFilter: (f: Partial<Pick<LocationContextState,
    'filterZoneIds' | 'filterFloorFrom' | 'filterFloorTo'>>) => void;
  clearFilter: () => void;
}

export const useLocationContextStore = create<LocationContextState>()(
  persist(
    (set) => ({
      byEstimate: {},
      setAddContext: (estimateId, ctx) =>
        set((s) => ({ byEstimate: { ...s.byEstimate, [estimateId]: ctx } })),
      clearAddContext: (estimateId) =>
        set((s) => ({ byEstimate: { ...s.byEstimate, [estimateId]: EMPTY_ADD_CONTEXT } })),

      addEnabled: {},
      setAddEnabled: (estimateId, enabled) =>
        set((s) => ({ addEnabled: { ...s.addEnabled, [estimateId]: enabled } })),

      filterZoneIds: [],
      filterFloorFrom: null,
      filterFloorTo: null,
      setFilter: (f) => set((s) => ({ ...s, ...f })),
      clearFilter: () =>
        set({ filterZoneIds: [], filterFloorFrom: null, filterFloorTo: null }),
    }),
    {
      name: 'estimat:loc-ctx',
      version: 1,
      // Персистим контекст добавления и флаг применения; фильтр — транзиентный.
      partialize: (s) => ({ byEstimate: s.byEstimate, addEnabled: s.addEnabled }),
    },
  ),
);

// Хелпер: контекст добавления для сметы (с дефолтом).
export function useAddContext(estimateId: string): LocationAddContext {
  return useLocationContextStore((s) => s.byEstimate[estimateId] ?? EMPTY_ADD_CONTEXT);
}

// Хелпер: включён ли контекст добавления для сметы.
export function useAddEnabled(estimateId: string): boolean {
  return useLocationContextStore((s) => s.addEnabled[estimateId] ?? false);
}

// Текущий контекст добавления с учётом флага: EMPTY, если выключен.
export function getEffectiveAddContext(estimateId: string): LocationAddContext {
  const s = useLocationContextStore.getState();
  return s.addEnabled[estimateId] ? (s.byEstimate[estimateId] ?? EMPTY_ADD_CONTEXT) : EMPTY_ADD_CONTEXT;
}
