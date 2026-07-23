import type { ColumnsType } from 'antd/es/table';

// Настройка отображения столбцов списковых таблиц (видимость + порядок) — generic-обобщение
// механики смет (smetaColumnsStore + worksColumns.applyColumnPrefs). Служебные столбцы
// (непрочитанные, «№» строки) в настройку не входят и остаются слева; «Действия» входит в
// настройку как required — перемещается, но не выключается.

export interface ColumnDef {
  key: string;
  label: string;
  /** required — нельзя скрыть (можно только переставлять). */
  required?: boolean;
  /** Скрыт по умолчанию; явный выбор пользователя перекрывает. */
  defaultHidden?: boolean;
  /** Столбец может быть уровнем иерархии (переключатель «Группировать» в заголовке). */
  groupable?: boolean;
}

export interface ColumnPrefs {
  /** Эффективный порядок известных ключей (нормализованный). */
  order: string[];
  /** Эффективная видимость по ключу (required всегда видимы). */
  hidden: Record<string, boolean>;
}

// Нормализация persisted-настроек: выкинуть неизвестные ключи, вставить новые (появившиеся
// в defs) на их место из defs, required-колонки считать видимыми даже если помечены hidden.
// Дефолтная видимость — из defs.defaultHidden, явное значение пользователя её перекрывает.
//
// «Место из defs» = сразу за ближайшим предшественником по defs, который уже стоит в сохранённом
// порядке (предшественников нет — в начало). Раньше новый ключ всегда дописывался в конец, поэтому
// добавленный в середину столбец у тех, кто таблицу уже открывал, уезжал в хвост, и порядок у
// старых и новых пользователей расходился. Ключей, уже сохранённых у пользователя, правило не
// касается — его порядок и перестановки сохраняются.
export function resolveColumnPrefs(
  defs: ColumnDef[],
  order: string[],
  hidden: Record<string, boolean>,
): ColumnPrefs {
  const known = new Set(defs.map((d) => d.key));
  const required = new Set(defs.filter((d) => d.required).map((d) => d.key));
  const defaultHidden = new Set(defs.filter((d) => d.defaultHidden).map((d) => d.key));
  const seen = new Set<string>();
  const norm: string[] = [];
  for (const k of order) if (known.has(k) && !seen.has(k)) { norm.push(k); seen.add(k); }
  defs.forEach((d, i) => {
    if (seen.has(d.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = norm.indexOf(defs[j]!.key);
      if (prev >= 0) { at = prev + 1; break; }
    }
    norm.splice(at, 0, d.key);
    seen.add(d.key);
  });
  const effHidden: Record<string, boolean> = {};
  for (const k of norm)
    effHidden[k] = required.has(k) ? false : (hidden[k] ?? defaultHidden.has(k));
  return { order: norm, hidden: effHidden };
}

/**
 * Применить настройки столбцов к готовому массиву колонок. Настраиваемые (key входит в defs)
 * переупорядочиваются по order и фильтруются по hidden. Служебные колонки (не в defs: выбор,
 * непрочитанные, «№», «Действия») в настройку не входят и сохраняют своё место: те, что стояли
 * до/среди настраиваемых — ведущими слева; те, что после последней настраиваемой — хвостовыми
 * справа. Работает только по фактически присутствующим колонкам (условные — «Подрядчик» у
 * подрядчика, «Действие» не-админа — безопасно отсутствуют). fixed:'right' остаётся только у
 * последней колонки (иначе AntD ломает раскладку).
 */
export function applyColumnPrefs<T>(cols: ColumnsType<T>, prefs: ColumnPrefs): ColumnsType<T> {
  const orderSet = new Set(prefs.order);
  const isConfigurable = (c: ColumnsType<T>[number]) => typeof c.key === 'string' && orderSet.has(c.key);
  const configIdx = cols.map((c, i) => (isConfigurable(c) ? i : -1)).filter((i) => i >= 0);
  const lastCfg = configIdx.length ? Math.max(...configIdx) : -1;

  const leading: ColumnsType<T> = [];
  const trailing: ColumnsType<T> = [];
  const byKey = new Map<string, ColumnsType<T>[number]>();
  cols.forEach((c, i) => {
    if (isConfigurable(c)) { byKey.set(c.key as string, c); return; }
    if (i > lastCfg) trailing.push(c);
    else leading.push(c);
  });

  const middle = prefs.order
    .filter((k) => byKey.has(k) && !prefs.hidden[k])
    .map((k) => byKey.get(k)!);
  const out = [...leading, ...middle, ...trailing];
  return out.map((c, i) =>
    i < out.length - 1 && (c as { fixed?: unknown }).fixed === 'right' ? { ...c, fixed: undefined } : c,
  );
}
