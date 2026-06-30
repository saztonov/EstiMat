import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Контекст добавления — одна зона + точный набор этажей, куда падают новые работы.
// Этажи хранятся сырым текстом («-1-10, 12, 16-18»); пусто = весь корпус.
// Тип помещения временно скрыт во всём локационном UX (roomTypeId не задаётся).
export interface LocationAddContext {
  zoneId: string | null;
  floorsText: string;
}

export const EMPTY_ADD_CONTEXT: LocationAddContext = {
  zoneId: null,
  floorsText: '',
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
  // Этажи — сырой текст с диапазонами («2-4, 6, 11-18»), парсится через parseFloors.
  filterZoneIds: string[];
  filterFloorsText: string;
  filterLocationTypeIds: string[];
  filterVolumeType: 'all' | 'main' | 'additional';
  setFilter: (f: Partial<Pick<LocationContextState,
    'filterZoneIds' | 'filterFloorsText' | 'filterLocationTypeIds' | 'filterVolumeType'>>) => void;
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
      filterFloorsText: '',
      filterLocationTypeIds: [],
      filterVolumeType: 'all',
      setFilter: (f) => set((s) => ({ ...s, ...f })),
      clearFilter: () =>
        set({ filterZoneIds: [], filterFloorsText: '', filterLocationTypeIds: [], filterVolumeType: 'all' }),
    }),
    {
      name: 'estimat:loc-ctx',
      version: 2,
      // Персистим контекст добавления и флаг применения; фильтр — транзиентный.
      partialize: (s) => ({ byEstimate: s.byEstimate, addEnabled: s.addEnabled }),
      // v1 хранил диапазон {floorFrom, floorTo}; v2 — текст этажей {floorsText}.
      migrate: (persisted: unknown, fromVersion: number) => {
        const state = (persisted ?? {}) as { byEstimate?: Record<string, unknown>; addEnabled?: Record<string, boolean> };
        if (fromVersion < 2 && state.byEstimate) {
          const migrated: Record<string, LocationAddContext> = {};
          for (const [id, raw] of Object.entries(state.byEstimate)) {
            const v = (raw ?? {}) as { zoneId?: string | null; floorFrom?: number | null; floorTo?: number | null };
            const from = v.floorFrom ?? null;
            const to = v.floorTo ?? null;
            const floorsText =
              from == null && to == null ? '' : from === to ? `${from ?? to}` : `${from ?? to}-${to ?? from}`;
            migrated[id] = { zoneId: v.zoneId ?? null, floorsText };
          }
          state.byEstimate = migrated;
        }
        return state;
      },
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
