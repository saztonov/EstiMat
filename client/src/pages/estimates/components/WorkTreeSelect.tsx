import { useMemo } from 'react';
import { TreeSelect } from 'antd';
import type { TreeSelectProps } from 'antd';

// Работа сметы как цель переноса материала. Поля категории/вида нужны
// для построения дерева Категория → Вид работ → Работа.
export interface WorkOption {
  id: string;
  label: string; // наименование работы (description)
  costTypeId: string | null;
  costTypeName: string | null;
  costCategoryId: string | null;
  costCategoryName: string | null;
}

interface Props {
  works: WorkOption[];
  /** Исключить работу из списка (при одиночном переносе — текущую). */
  excludeId?: string;
  disabled?: boolean;
  /** Выбрана работа-лист — выполнить перенос. */
  onPick: (workId: string) => void;
}

type TreeNode = NonNullable<TreeSelectProps['treeData']>[number];

const NO_CAT = '__nocat__';
const NO_TYPE = '__notype__';

// Группировка работ в дерево Категория → Вид работ → Работа.
// Порядок узлов — как в исходном массиве (works уже отсортированы по категории→виду).
// Выбираются только листья-работы; категории и виды служат группировкой.
function buildTree(works: WorkOption[], excludeId?: string): TreeNode[] {
  type Cat = { id: string; name: string; types: Map<string, WorkOption[]>; typeNames: Map<string, string>; order: string[] };
  const catMap = new Map<string, Cat>();
  const catOrder: string[] = [];

  for (const w of works) {
    if (excludeId && w.id === excludeId) continue;
    const catId = w.costCategoryId ?? NO_CAT;
    let cat = catMap.get(catId);
    if (!cat) {
      cat = { id: catId, name: w.costCategoryName ?? 'Без категории', types: new Map(), typeNames: new Map(), order: [] };
      catMap.set(catId, cat);
      catOrder.push(catId);
    }
    const typeId = w.costTypeId ?? NO_TYPE;
    let bucket = cat.types.get(typeId);
    if (!bucket) {
      bucket = [];
      cat.types.set(typeId, bucket);
      cat.typeNames.set(typeId, w.costTypeName ?? 'Без вида работ');
      cat.order.push(typeId);
    }
    bucket.push(w);
  }

  return catOrder.map((catId) => {
    const cat = catMap.get(catId)!;
    return {
      value: `cat:${cat.id}`,
      title: cat.name,
      selectable: false,
      children: cat.order.map((typeId) => ({
        value: `type:${cat.id}:${typeId}`,
        title: cat.typeNames.get(typeId) ?? 'Без вида работ',
        selectable: false,
        children: (cat.types.get(typeId) ?? []).map((w) => ({
          value: w.id,
          title: w.label,
          isLeaf: true,
        })),
      })),
    };
  });
}

// Выбор работы-цели при переносе материалов: дерево с поиском.
// Выпадающий список расширяется по содержимому (потолок 500px), длинные
// наименования переносятся на новую строку (CSS .estimat-work-tree-popup).
export function WorkTreeSelect({ works, excludeId, disabled, onPick }: Props) {
  const treeData = useMemo(() => buildTree(works, excludeId), [works, excludeId]);

  return (
    <TreeSelect
      showSearch
      size="small"
      autoFocus
      disabled={disabled}
      style={{ width: 320 }}
      placeholder="Выберите работу"
      popupMatchSelectWidth={false}
      popupClassName="estimat-work-tree-popup"
      dropdownStyle={{ minWidth: 320, maxWidth: 500 }}
      treeDefaultExpandAll
      treeNodeFilterProp="title"
      treeData={treeData}
      onSelect={(val) => onPick(String(val))}
    />
  );
}
