// Чистая логика поколоночных отборов (без UI): значения фильтров, спецификации колонок и
// применение к строкам. Отборы работают по полному загруженному набору (режим all=1), поэтому
// фильтрация — на клиенте, до группировки. UI-дропдауны — в tableHeaderFilters.tsx.

export type ColumnFilterValue =
  | { kind: 'text'; value: string }
  | { kind: 'multi'; values: string[] }
  | { kind: 'dateRange'; from?: string; to?: string } // YYYY-MM-DD включительно
  | { kind: 'numRange'; min?: number; max?: number };

export interface ColumnFilterSpec<T> {
  kind: ColumnFilterValue['kind'];
  /** text: строка для поиска по вхождению; multi: значение варианта. */
  getText?: (r: T) => string | null | undefined;
  /**
   * multi: НЕСКОЛЬКО значений одной ячейки (подрядчики заказа, номера заявок схлопнутой строки).
   * Строка проходит отбор, если совпало ЛЮБОЕ из них; варианты собираются из всех значений.
   * Задан — перекрывает getText.
   */
  getTexts?: (r: T) => (string | null | undefined)[];
  /** multi: подпись варианта (по умолчанию — само значение). */
  labelOf?: (value: string) => string;
  /** dateRange: ISO-дата/timestamp ячейки. */
  getDate?: (r: T) => string | null | undefined;
  /**
   * dateRange: НЕСКОЛЬКО дат одной ячейки (график поставок схлопнутой строки).
   * Строка проходит, если в диапазон попала ЛЮБАЯ дата. Задан — перекрывает getDate.
   */
  getDates?: (r: T) => (string | null | undefined)[];
  /** numRange: числовое значение ячейки. */
  getNum?: (r: T) => number | string | null | undefined;
  /** multi: фиксированный набор вариантов (иначе собирается из строк). */
  options?: { value: string; label: string }[];
}

export type ColumnFilters = Record<string, ColumnFilterValue | undefined>;

export function isColumnFilterActive(v: ColumnFilterValue | undefined): boolean {
  if (!v) return false;
  switch (v.kind) {
    case 'text': return v.value.trim() !== '';
    case 'multi': return v.values.length > 0;
    case 'dateRange': return !!v.from || !!v.to;
    case 'numRange': return v.min != null || v.max != null;
  }
}

// Календарный день ячейки для сравнения с выбранным пользователем (тоже локальным) диапазоном.
// Дата-строку 'YYYY-MM-DD' (без TZ) берём как есть; timestamptz приводим к ЛОКАЛЬНОМУ дню —
// чтобы отбор совпадал с тем, что показывает колонка через toLocaleString (локальный TZ).
function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // чистая дата — без сдвига
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.length >= 10 ? s.slice(0, 10) : null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function matchesOne<T>(row: T, v: ColumnFilterValue, spec: ColumnFilterSpec<T>): boolean {
  switch (v.kind) {
    case 'text': {
      const needle = v.value.trim().toLowerCase();
      if (!needle) return true;
      return String(spec.getText?.(row) ?? '').toLowerCase().includes(needle);
    }
    case 'multi': {
      if (v.values.length === 0) return true;
      // Многозначная ячейка — совпало любое из значений (getTexts перекрывает getText).
      // Предикат тот же, что в collectMultiOptions: пустое значение вариантом не становится,
      // поэтому и совпадать по нему нельзя (иначе строка недостижима ни одной галочкой).
      if (spec.getTexts) {
        return spec.getTexts(row).some((t) => !!t && v.values.includes(String(t)));
      }
      return v.values.includes(String(spec.getText?.(row) ?? ''));
    }
    case 'dateRange': {
      const inRange = (iso: string | null | undefined) => {
        const day = dayOf(iso);
        if (!day) return false;
        if (v.from && day < v.from) return false;
        if (v.to && day > v.to) return false;
        return true;
      };
      // Несколько дат в ячейке (график поставок) — попала любая.
      if (spec.getDates) return spec.getDates(row).some(inRange);
      return inRange(spec.getDate?.(row));
    }
    case 'numRange': {
      const raw = spec.getNum?.(row);
      // Пустая строка/пробелы — не число (Number('')===0 иначе ложно попадёт в диапазон с 0).
      const n = raw == null || (typeof raw === 'string' && raw.trim() === '') ? null : Number(raw);
      if (n == null || Number.isNaN(n)) return false;
      if (v.min != null && n < v.min) return false;
      if (v.max != null && n > v.max) return false;
      return true;
    }
  }
}

/**
 * Отфильтровать строки по активным отборам. hiddenKeys — скрытые столбцы: их отборы
 * игнорируются (скрытие столбца снимает его отбор).
 */
export function applyColumnFilters<T>(
  rows: T[],
  filters: ColumnFilters,
  specs: Record<string, ColumnFilterSpec<T> | undefined>,
  hidden?: Record<string, boolean>,
): T[] {
  const active = Object.entries(filters).filter(([key, v]) => {
    if (!v || !isColumnFilterActive(v)) return false;
    if (hidden?.[key]) return false;
    return !!specs[key];
  });
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every(([key, v]) => matchesOne(r, v!, specs[key]!)));
}

/** Есть ли хоть один действующий отбор (по видимым столбцам). */
export function hasActiveColumnFilters(
  filters: ColumnFilters,
  hidden?: Record<string, boolean>,
): boolean {
  return Object.entries(filters).some(([key, v]) => isColumnFilterActive(v) && !hidden?.[key]);
}

/** Варианты для multi-отбора: из спецификации либо уникальные значения строк (сорт. по-русски). */
export function collectMultiOptions<T>(
  rows: T[],
  spec: ColumnFilterSpec<T>,
): { value: string; label: string }[] {
  if (spec.options) return spec.options;
  const seen = new Set<string>();
  for (const r of rows) {
    // Многозначная ячейка даёт по варианту на каждое значение (getTexts перекрывает getText).
    if (spec.getTexts) {
      for (const t of spec.getTexts(r)) if (t) seen.add(String(t));
      continue;
    }
    const v = spec.getText?.(r);
    if (v) seen.add(String(v));
  }
  // Сортируем по ПОДПИСИ, а не по коду: у спек с labelOf (вид заказа, статус, тип заявки)
  // значения — латинские ключи, и сортировка по ним давала список не по русскому алфавиту.
  return [...seen]
    .map((v) => ({ value: v, label: spec.labelOf?.(v) ?? v }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}
