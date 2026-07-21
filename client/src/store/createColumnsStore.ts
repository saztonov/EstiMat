import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ColumnDef, type ColumnPrefs, resolveColumnPrefs } from '../lib/columnPrefs';

// Фабрика store настроек столбцов списковой таблицы: у каждой таблицы свой ключ localStorage
// (estimat:cols:<таблица>) и свой набор defs. Хранится порядок, видимость и активные уровни
// группировки; значения отборов не сохраняются. Смета живёт на собственном store
// (smetaColumnsStore) — ключи не пересекаются.

export interface TableColumnsState {
  order: string[];
  hidden: Record<string, boolean>;
  /** Ключи столбцов-уровней дерева (порядок уровней — из order, не из порядка включения). */
  groupBy: string[];
  setHidden: (key: string, hidden: boolean) => void;
  setOrder: (order: string[]) => void;
  toggleGroupBy: (key: string, on: boolean) => void;
  /** Снять всю группировку, не трогая порядок и видимость столбцов (кнопка «Сбросить иерархию»). */
  clearGroupBy: () => void;
  /** «По умолчанию»: исходный порядок/видимость из defs + плоский вид. */
  reset: () => void;
}

export interface TableColumnsStore {
  useStore: ReturnType<typeof createStore>;
  defs: ColumnDef[];
  resolve: (order: string[], hidden: Record<string, boolean>) => ColumnPrefs;
}

function createStore(key: string, defaultOrder: string[], version: number) {
  return create<TableColumnsState>()(
    persist(
      (set) => ({
        order: [...defaultOrder],
        hidden: {},
        groupBy: [],
        // Скрытие столбца снимает и его группировку (отбор снимается на уровне applyColumnFilters).
        setHidden: (k, hidden) =>
          set((s) => ({
            hidden: { ...s.hidden, [k]: hidden },
            groupBy: hidden ? s.groupBy.filter((g) => g !== k) : s.groupBy,
          })),
        setOrder: (order) => set({ order }),
        toggleGroupBy: (k, on) =>
          set((s) => ({ groupBy: on ? (s.groupBy.includes(k) ? s.groupBy : [...s.groupBy, k]) : s.groupBy.filter((g) => g !== k) })),
        clearGroupBy: () => set({ groupBy: [] }),
        reset: () => set({ order: [...defaultOrder], hidden: {}, groupBy: [] }),
      }),
      { name: key, version },
    ),
  );
}

export function createTableColumnsStore(cfg: {
  key: string;
  defs: ColumnDef[];
  version?: number;
}): TableColumnsStore {
  const defaultOrder = cfg.defs.map((d) => d.key);
  return {
    useStore: createStore(cfg.key, defaultOrder, cfg.version ?? 1),
    defs: cfg.defs,
    resolve: (order, hidden) => resolveColumnPrefs(cfg.defs, order, hidden),
  };
}
