import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Настройка отображения столбцов таблицы работ сметы (видимость + порядок), общая для
// всех смет пользователя. Служебные столбцы (грип перетаскивания, раскрытие материалов,
// «№», действия) в настройку НЕ входят и всегда на своих местах.

export interface SmetaColumnDef {
  key: string;
  label: string;
  /** required — нельзя скрыть (можно только переставлять). */
  required?: boolean;
}

// Порядок этого массива = дефолтный порядок столбцов (текущий вид принят за дефолт).
export const SMETA_COLUMN_DEFS: SmetaColumnDef[] = [
  { key: 'description', label: 'Наименование работы', required: true },
  { key: 'unit', label: 'Ед.', required: true },
  { key: 'quantity', label: 'Кол-во', required: true },
  { key: 'unit_price', label: 'Цена' },
  { key: 'total', label: 'Сумма' },
  { key: 'location', label: 'Местоположение' },
  { key: 'comments', label: 'Прим.' },
];

const DEFAULT_ORDER = SMETA_COLUMN_DEFS.map((d) => d.key);
const KNOWN = new Set(DEFAULT_ORDER);
const REQUIRED = new Set(SMETA_COLUMN_DEFS.filter((d) => d.required).map((d) => d.key));

interface SmetaColumnsState {
  hidden: Record<string, boolean>;
  order: string[];
  setHidden: (key: string, hidden: boolean) => void;
  setOrder: (order: string[]) => void;
  reset: () => void;
}

export const useSmetaColumnsStore = create<SmetaColumnsState>()(
  persist(
    (set) => ({
      hidden: {},
      order: DEFAULT_ORDER,
      setHidden: (key, hidden) => set((s) => ({ hidden: { ...s.hidden, [key]: hidden } })),
      setOrder: (order) => set({ order }),
      reset: () => set({ hidden: {}, order: [...DEFAULT_ORDER] }),
    }),
    { name: 'estimat:smeta-columns', version: 1 },
  ),
);

export interface ColumnPrefs {
  /** Эффективный порядок известных ключей (нормализованный). */
  order: string[];
  /** Эффективная видимость по ключу (required всегда видимы). */
  hidden: Record<string, boolean>;
}

// Нормализация persisted-настроек: выкинуть неизвестные ключи, дописать новые (появившиеся
// в SMETA_COLUMN_DEFS) в конец, required-колонки считать видимыми даже если помечены hidden.
export function resolveColumnPrefs(order: string[], hidden: Record<string, boolean>): ColumnPrefs {
  const seen = new Set<string>();
  const norm: string[] = [];
  for (const k of order) if (KNOWN.has(k) && !seen.has(k)) { norm.push(k); seen.add(k); }
  for (const k of DEFAULT_ORDER) if (!seen.has(k)) { norm.push(k); seen.add(k); }
  const effHidden: Record<string, boolean> = {};
  for (const k of norm) effHidden[k] = REQUIRED.has(k) ? false : !!hidden[k];
  return { order: norm, hidden: effHidden };
}
