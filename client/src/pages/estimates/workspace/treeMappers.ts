import type { DataNode } from 'antd/es/tree';
import type { RateTreeCategory, RateLeafPayload } from './types';

// Узел дерева работ с прикреплённой нагрузкой листа и текстом для поиска.
// Подписи переименованы по требованию: «категория затрат» → «Категория»,
// «вид затрат» → «Вид работ», лист — наименование расценки.
export interface RateTreeNode extends DataNode {
  nodeKind: 'cat' | 'type' | 'rate';
  searchText: string;
  payload?: RateLeafPayload; // только у листьев (rate)
  children?: RateTreeNode[];
}

export function mapRatesTreeToNodes(tree: RateTreeCategory[]): RateTreeNode[] {
  return tree.map((cat) => ({
    key: `cat:${cat.id}`,
    nodeKind: 'cat',
    selectable: false,
    title: cat.name,
    searchText: cat.name.toLowerCase(),
    children: cat.types.map((t) => ({
      key: `type:${t.id}`,
      nodeKind: 'type',
      selectable: false,
      title: t.name,
      searchText: t.name.toLowerCase(),
      children: t.rates.map((r): RateTreeNode => {
        const name = r.code ? `[${r.code}] ${r.name}` : r.name;
        const payload: RateLeafPayload = {
          rateId: r.id,
          costTypeId: t.id,
          costTypeName: t.name,
          costCategoryId: cat.id,
          costCategoryName: cat.name,
          name,
          code: r.code,
          unit: r.unit,
          price: Number(r.price ?? 0),
        };
        return {
          key: `rate:${r.id}`,
          nodeKind: 'rate',
          isLeaf: true,
          selectable: false,
          payload,
          title: name,
          searchText: `${r.name} ${r.code ?? ''}`.toLowerCase(),
        };
      }),
    })),
  }));
}

// Сужение дерева по области подбора (разделы/виды), выбранной сметчиком.
// Пусто — возвращаем как есть. Иначе оставляем выбранные категории и (если заданы)
// только выбранные виды внутри них.
export function filterRateNodesByScope(
  nodes: RateTreeNode[],
  categoryIds: string[],
  costTypeIds: string[],
): RateTreeNode[] {
  if (categoryIds.length === 0 && costTypeIds.length === 0) return nodes;
  const catSet = new Set(categoryIds.map((id) => `cat:${id}`));
  const typeSet = new Set(costTypeIds.map((id) => `type:${id}`));
  return nodes
    .filter((c) => catSet.size === 0 || catSet.has(String(c.key)))
    .map((c) => ({
      ...c,
      children: (c.children ?? []).filter((t) => typeSet.size === 0 || typeSet.has(String(t.key))),
    }))
    .filter((c) => (c.children?.length ?? 0) > 0);
}

// Собрать ключи всех раскрываемых узлов (у которых есть дети) — рекурсивно.
// Используется для «развернуть всё» и для раскрытия поддерева совпавшего контейнера.
export function collectExpandableKeys(nodes: RateTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: RateTreeNode[]) => {
    for (const n of list) {
      if (n.children?.length) {
        out.push(String(n.key));
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

// Фильтрация дерева по подстроке. Правило (не зависит от вида узла):
// - контейнер (узел с детьми), чьё собственное имя совпало, показываем ЦЕЛИКОМ
//   со всеми детьми и раскрываем всё его поддерево;
// - контейнер без совпадения имени сохраняем, только если внутри есть совпавшие
//   потомки (и тогда оставляем лишь их);
// - лист включаем при прямом совпадении.
// Возвращаем также уникальные ключи, которые надо раскрыть, чтобы показать совпадения.
export function filterRateNodes(
  nodes: RateTreeNode[],
  query: string,
): { nodes: RateTreeNode[]; expandedKeys: string[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { nodes, expandedKeys: [] };

  const expanded: string[] = [];
  const walk = (list: RateTreeNode[]): RateTreeNode[] => {
    const out: RateTreeNode[] = [];
    for (const n of list) {
      if (n.children?.length) {
        if (n.searchText.includes(q)) {
          // Совпал сам контейнер — показываем его целиком и раскрываем поддерево.
          expanded.push(String(n.key), ...collectExpandableKeys(n.children));
          out.push(n);
        } else {
          const kids = walk(n.children);
          if (kids.length) {
            expanded.push(String(n.key));
            out.push({ ...n, children: kids });
          }
        }
      } else if (n.searchText.includes(q)) {
        out.push(n);
      }
    }
    return out;
  };

  return { nodes: walk(nodes), expandedKeys: [...new Set(expanded)] };
}
