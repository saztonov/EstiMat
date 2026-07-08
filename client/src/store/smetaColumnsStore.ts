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

// Денежные колонки по умолчанию скрыты (и на десктопе, и на мобильном) — включаются
// пользователем в настройке столбцов; явный выбор сохраняется.
const DEFAULT_HIDDEN: Record<string, boolean> = { unit_price: true, total: true };

/** Дефолты видимости для телефона (<768px): применяются только пока пользователь
 *  не задал явного значения (см. resolveColumnPrefs). */
export const PHONE_HIDDEN_DEFAULTS: Record<string, boolean> = { location: true, comments: true };

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
      hidden: { ...DEFAULT_HIDDEN },
      order: DEFAULT_ORDER,
      setHidden: (key, hidden) => set((s) => ({ hidden: { ...s.hidden, [key]: hidden } })),
      setOrder: (order) => set({ order }),
      reset: () => set({ hidden: { ...DEFAULT_HIDDEN }, order: [...DEFAULT_ORDER] }),
    }),
    {
      name: 'estimat:smeta-columns',
      version: 2,
      // v1→v2: денежные колонки скрываются один раз даже у пользователей с сохранённой
      // настройкой; повторное включение пишет явное false и больше не мигрируется.
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<Pick<SmetaColumnsState, 'hidden' | 'order'>>;
        if (version < 2) return { ...s, hidden: { ...s.hidden, ...DEFAULT_HIDDEN } };
        return s;
      },
    },
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
// viewportDefaults — дефолты видимости для текущего устройства (например, телефона):
// действуют только для колонок без явного пользовательского значения.
export function resolveColumnPrefs(
  order: string[],
  hidden: Record<string, boolean>,
  viewportDefaults?: Record<string, boolean>,
): ColumnPrefs {
  const seen = new Set<string>();
  const norm: string[] = [];
  for (const k of order) if (KNOWN.has(k) && !seen.has(k)) { norm.push(k); seen.add(k); }
  for (const k of DEFAULT_ORDER) if (!seen.has(k)) { norm.push(k); seen.add(k); }
  const effHidden: Record<string, boolean> = {};
  for (const k of norm)
    effHidden[k] = REQUIRED.has(k) ? false : (hidden[k] ?? viewportDefaults?.[k] ?? false);
  return { order: norm, hidden: effHidden };
}
