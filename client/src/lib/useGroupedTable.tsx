import { useEffect, useMemo, useState, type Key, type ReactNode } from 'react';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { applyColumnPrefs, type ColumnPrefs } from './columnPrefs';
import {
  applyColumnFilters, hasActiveColumnFilters, type ColumnFilters, type ColumnFilterSpec,
} from './columnFilters';
import { headerFilterCol } from './tableHeaderFilters';
import {
  groupRows, levelsFromOrder, collectGroupKeys, applyGroupSpan, isGroupRow,
  type GroupLevel, type GroupNode, type GroupRow,
} from './tableGrouping';
import type { TableColumnsStore } from '../store/createColumnsStore';

// Общая логика плоских списковых таблиц: настройки столбцов (порядок/видимость/уровни дерева) +
// поколоночные отборы + группировка. Отбор/дерево строятся на клиенте по всему набору → при
// needFull таблица грузит all=1. needFull считается ОДНОЙ формулой (computeNeedFull) и в
// компоненте (для queryKey до данных), и здесь. Данные и дерево мемоизируются; раскрытие дерева
// управляемое (можно сворачивать), пересобирается только при смене состава ВЕРХНИХ групп.

/** Единая формула «нужен полный набор»: активная группировка, отбор в заголовке или «подсмотр». */
export function computeNeedFull(
  prefs: ColumnPrefs,
  groupBy: string[],
  colFilters: ColumnFilters,
  peek: boolean,
): boolean {
  return peek || groupBy.some((k) => !prefs.hidden[k]) || hasActiveColumnFilters(colFilters, prefs.hidden);
}

export interface GroupedTable<T> {
  prefs: ColumnPrefs;
  treeMode: boolean;
  /** Данные для Table (плоские строки или дерево групп), мемоизированы. */
  data: GroupRow<T>[];
  /** Свойства заголовка столбца: отбор + переключатель «Группировать» + подсмотр полного набора. */
  hf: (key: string, spec: ColumnFilterSpec<T>) => Pick<ColumnType<GroupRow<T>>, 'filterDropdown' | 'filterIcon' | 'onFilterDropdownOpenChange'>;
  /** Применить порядок/видимость (+ разворот групповых строк в дереве). */
  view: (leafColumns: ColumnsType<GroupRow<T>>, renderGroup: (node: GroupNode<T>) => ReactNode) => ColumnsType<GroupRow<T>>;
  /** Конфиг раскрытия для <Table expandable> (undefined в плоском режиме). */
  expandable: { expandedRowKeys: string[]; onExpandedRowsChange: (keys: readonly Key[]) => void } | undefined;
}

export function useGroupedTable<T>(args: {
  store: TableColumnsStore;
  rows: T[];
  filterSpecs: Record<string, ColumnFilterSpec<T>>;
  levelMap: Record<string, GroupLevel<T> | undefined>;
  aggregate?: (items: T[]) => Record<string, number>;
  colFilters: ColumnFilters;
  setColFilters: (updater: (f: ColumnFilters) => ColumnFilters) => void;
  /** Вызывается при открытии дропдауна отбора — компонент включает полный набор (для вариантов multi). */
  onPeek?: () => void;
  onChange?: () => void;
}): GroupedTable<T> {
  const order = args.store.useStore((s) => s.order);
  const hidden = args.store.useStore((s) => s.hidden);
  const groupBy = args.store.useStore((s) => s.groupBy);
  const toggleGroupBy = args.store.useStore((s) => s.toggleGroupBy);
  const prefs = args.store.resolve(order, hidden);
  const { colFilters, setColFilters, rows } = args;

  const groupable = useMemo(
    () => new Set(args.store.defs.filter((d) => d.groupable).map((d) => d.key)),
    [args.store],
  );

  const levels = levelsFromOrder(prefs.order, groupBy, prefs.hidden, args.levelMap);
  const treeMode = levels.length > 0;

  // Тяжёлая часть (фильтрация всего набора + построение дерева) — мемоизируется.
  const data = useMemo<GroupRow<T>[]>(() => {
    const filtered = applyColumnFilters(rows, colFilters, args.filterSpecs, prefs.hidden);
    return treeMode ? groupRows(filtered, levels, args.aggregate) : filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, colFilters, order, hidden, groupBy]);

  // Управляемое раскрытие: раскрываем все группы, но пересобираем только при смене состава
  // ВЕРХНИХ групп (не на каждое изменение внутри) — иначе ручное сворачивание сбрасывалось бы.
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const topSignature = treeMode ? data.filter(isGroupRow).map((g) => g.key).join('|') : '';
  useEffect(() => {
    setExpandedKeys(treeMode ? collectGroupKeys(data) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSignature]);

  const setColFilter = (key: string, v: ColumnFilters[string]) => {
    setColFilters((f) => ({ ...f, [key]: v }));
    args.onChange?.();
  };

  const hf = (
    key: string,
    spec: ColumnFilterSpec<T>,
  ): Pick<ColumnType<GroupRow<T>>, 'filterDropdown' | 'filterIcon' | 'onFilterDropdownOpenChange'> => ({
    ...headerFilterCol<T>({
      spec, value: colFilters[key], rows, onChange: (v) => setColFilter(key, v),
      group: groupable.has(key)
        ? { active: groupBy.includes(key), onToggle: (on) => { toggleGroupBy(key, on); args.onChange?.(); } }
        : undefined,
    }),
    // Открытие дропдауна включает полный набор — иначе варианты multi берутся лишь с текущей страницы.
    onFilterDropdownOpenChange: (open: boolean) => { if (open) args.onPeek?.(); },
  });

  const view = (leafColumns: ColumnsType<GroupRow<T>>, renderGroup: (node: GroupNode<T>) => ReactNode) => {
    const ordered = applyColumnPrefs(leafColumns, prefs);
    return treeMode ? applyGroupSpan(ordered, renderGroup) : ordered;
  };

  return {
    prefs, treeMode, data, hf, view,
    expandable: treeMode
      ? { expandedRowKeys: expandedKeys, onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)) }
      : undefined,
  };
}
