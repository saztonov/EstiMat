import { useMemo, type ReactNode } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { applyColumnPrefs, type ColumnPrefs } from './columnPrefs';
import {
  applyColumnFilters, hasActiveColumnFilters, type ColumnFilters, type ColumnFilterSpec,
} from './columnFilters';
import { headerFilterCol } from './tableHeaderFilters';
import {
  groupRows, levelsFromOrder, collectGroupKeys, applyGroupSpan,
  type GroupLevel, type GroupNode, type GroupRow,
} from './tableGrouping';
import type { TableColumnsStore } from '../store/createColumnsStore';

// Общая логика плоских списковых таблиц: настройки столбцов (порядок/видимость/уровни дерева) +
// поколоночные отборы + группировка. `needFull` не зависит от строк (только от отборов и уровней),
// поэтому запрос таблицы может выбрать режим all=1 до получения данных; данные строятся
// `buildData(rows)`, конвейер колонок — `view(...)`. Дерево разворачивается полностью (авто).

export interface GroupedTable<T> {
  prefs: ColumnPrefs;
  /** Нужен ли режим полного набора (all=1): активен отбор или уровень дерева. */
  needFull: boolean;
  treeMode: boolean;
  /** Свойства заголовка столбца: отбор + переключатель «Группировать». */
  hf: (key: string, spec: ColumnFilterSpec<T>) => ReturnType<typeof headerFilterCol<T>>;
  /** Отфильтровать (+ сгруппировать) строки полного набора. */
  buildData: (rows: T[]) => GroupRow<T>[];
  /** Ключи раскрытых групп (все) для дерева. */
  expandedKeys: (data: GroupRow<T>[]) => string[];
  /** Применить порядок/видимость (+ разворот групповых строк в дереве). */
  view: (leafColumns: ColumnsType<GroupRow<T>>, renderGroup: (node: GroupNode<T>) => ReactNode) => ColumnsType<GroupRow<T>>;
  clearColumnFilters: () => void;
}

export function useGroupedTable<T>(args: {
  store: TableColumnsStore;
  filterSpecs: Record<string, ColumnFilterSpec<T>>;
  levelMap: Record<string, GroupLevel<T> | undefined>;
  aggregate?: (items: T[]) => Record<string, number>;
  rowsForOptions: T[];
  /** Управляемое состояние отборов (в компоненте — чтобы считать needFull до запроса). */
  colFilters: ColumnFilters;
  setColFilters: (updater: (f: ColumnFilters) => ColumnFilters) => void;
  onChange?: () => void;
}): GroupedTable<T> {
  const order = args.store.useStore((s) => s.order);
  const hidden = args.store.useStore((s) => s.hidden);
  const groupBy = args.store.useStore((s) => s.groupBy);
  const toggleGroupBy = args.store.useStore((s) => s.toggleGroupBy);
  const prefs = args.store.resolve(order, hidden);
  const { colFilters, setColFilters } = args;

  const groupable = useMemo(
    () => new Set(args.store.defs.filter((d) => d.groupable).map((d) => d.key)),
    [args.store],
  );

  const levels = levelsFromOrder(prefs.order, groupBy, prefs.hidden, args.levelMap);
  const treeMode = levels.length > 0;
  const needFull = treeMode || hasActiveColumnFilters(colFilters, prefs.hidden);

  const setColFilter = (key: string, v: ColumnFilters[string]) => {
    setColFilters((f) => ({ ...f, [key]: v }));
    args.onChange?.();
  };

  const hf = (key: string, spec: ColumnFilterSpec<T>) =>
    headerFilterCol<T>({
      spec, value: colFilters[key], rows: args.rowsForOptions, onChange: (v) => setColFilter(key, v),
      group: groupable.has(key)
        ? { active: groupBy.includes(key), onToggle: (on) => { toggleGroupBy(key, on); args.onChange?.(); } }
        : undefined,
    });

  const buildData = (rows: T[]): GroupRow<T>[] => {
    const filtered = applyColumnFilters(rows, colFilters, args.filterSpecs, prefs.hidden);
    return treeMode ? groupRows(filtered, levels, args.aggregate) : filtered;
  };

  const view = (leafColumns: ColumnsType<GroupRow<T>>, renderGroup: (node: GroupNode<T>) => ReactNode) => {
    const ordered = applyColumnPrefs(leafColumns, prefs);
    return treeMode ? applyGroupSpan(ordered, renderGroup) : ordered;
  };

  return {
    prefs, needFull, treeMode, hf, buildData, view,
    expandedKeys: (data) => (treeMode ? collectGroupKeys(data) : []),
    clearColumnFilters: () => setColFilters(() => ({})),
  };
}
