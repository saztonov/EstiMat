import type { ReactNode } from 'react';
import type { ColumnsType } from 'antd/es/table';

// Generic-иерархия списковых таблиц: группировка строк по уровням-столбцам в порядке из
// настроек столбцов (обобщение groupRecursive из вкладки «Материалы»). Дерево строится на
// клиенте по полному набору (режим all=1) после применения поколоночных отборов.

export interface GroupLevel<T> {
  /** Ключ столбца — уровень дерева. */
  key: string;
  /** Идентификатор группы (id, не подпись — подписи неуникальны). */
  idOf: (r: T) => string;
  labelOf: (r: T) => string;
  /** Порядок групп; по умолчанию — по подписи по-русски. */
  cmp?: (a: T, b: T) => number;
}

export interface GroupNode<T> {
  _group: true;
  key: string;
  /** Ключ столбца, породившего уровень. */
  levelKey: string;
  depth: number;
  label: string;
  count: number;
  /** Все листовые строки под узлом (для агрегатов и группового назначения). */
  items: T[];
  agg: Record<string, number>;
  children: Array<GroupNode<T> | T>;
}

export type GroupRow<T> = GroupNode<T> | T;

export function isGroupRow<T>(r: GroupRow<T>): r is GroupNode<T> {
  return typeof r === 'object' && r !== null && '_group' in (r as object);
}

/** Префикс rowKey групповых строк — отличает их от листовых (uuid без «g:»). */
export const GROUP_KEY_PREFIX = 'g:';

export function groupRows<T>(
  rows: T[],
  levels: GroupLevel<T>[],
  aggregate?: (items: T[]) => Record<string, number>,
  keyPrefix = '',
  depth = 0,
): GroupRow<T>[] {
  const [level, ...rest] = levels;
  if (!level) return rows;
  const map = new Map<string, { sample: T; items: T[] }>();
  for (const r of rows) {
    const id = level.idOf(r);
    const g = map.get(id);
    if (g) g.items.push(r);
    else map.set(id, { sample: r, items: [r] });
  }
  const cmp = level.cmp ?? ((a: T, b: T) => level.labelOf(a).localeCompare(level.labelOf(b), 'ru'));
  return [...map.entries()]
    .sort((a, b) => cmp(a[1].sample, b[1].sample))
    .map(([id, g]) => {
      const key = `${GROUP_KEY_PREFIX}${keyPrefix}${level.key}:${id}`;
      return {
        _group: true as const,
        key,
        levelKey: level.key,
        depth,
        label: level.labelOf(g.sample),
        count: g.items.length,
        items: g.items,
        agg: aggregate ? aggregate(g.items) : {},
        children: groupRows(g.items, rest, aggregate, `${key}/`, depth + 1),
      };
    });
}

/** Ключи всех групповых узлов (для раскрытия дерева по умолчанию). */
export function collectGroupKeys<T>(rows: GroupRow<T>[]): string[] {
  const keys: string[] = [];
  const walk = (nodes: GroupRow<T>[]) => {
    for (const n of nodes) if (isGroupRow(n)) { keys.push(n.key); walk(n.children); }
  };
  walk(rows);
  return keys;
}

/**
 * Уровни дерева из настроек столбцов: отмеченные «Группировать» видимые столбцы в порядке
 * order (перестановка столбца перестраивает иерархию). Столбцы без accessor'а (нет в levelMap)
 * пропускаются.
 */
export function levelsFromOrder<T>(
  order: string[],
  groupBy: string[],
  hidden: Record<string, boolean>,
  levelMap: Record<string, GroupLevel<T> | undefined>,
): GroupLevel<T>[] {
  const active = new Set(groupBy);
  return order
    .filter((k) => active.has(k) && !hidden[k] && levelMap[k])
    .map((k) => levelMap[k]!);
}

/**
 * Групповая строка занимает всю ширину: рендер группы — в фактически первом столбце
 * (порядок настраиваемый, «первым» может стать любой), с выравниванием влево; остальным
 * colSpan:0. Существующие onCell/render колонок сохраняются для листовых строк.
 * В режиме дерева снимаем fixed:'right' со всех колонок — fixed-колонка, пересечённая
 * широкой групповой ячейкой (colSpan), рендерится AntD некорректно (шов/наложение).
 */
export function applyGroupSpan<T>(
  cols: ColumnsType<GroupRow<T>>,
  renderGroup: (node: GroupNode<T>) => ReactNode,
): ColumnsType<GroupRow<T>> {
  return cols.map((c, i) => {
    const orig = c as ColumnsType<GroupRow<T>>[number] & {
      onCell?: (r: GroupRow<T>, index?: number) => object;
      render?: (v: unknown, r: GroupRow<T>, index: number) => ReactNode;
    };
    const { fixed: _fixed, ...rest } = c as ColumnsType<GroupRow<T>>[number] & { fixed?: unknown };
    return {
      ...rest,
      onCell: (r: GroupRow<T>, index?: number) =>
        isGroupRow(r)
          ? (i === 0 ? { colSpan: cols.length, style: { textAlign: 'left' as const } } : { colSpan: 0 })
          : orig.onCell?.(r, index) ?? {},
      render: (v: unknown, r: GroupRow<T>, index: number) =>
        isGroupRow(r) ? (i === 0 ? renderGroup(r) : null) : orig.render ? orig.render(v, r, index) : (v as ReactNode),
    };
  });
}
