import type { Key } from 'react';
import type { DataNode } from 'antd/es/tree';
import type { RdTreeNode } from '@estimat/shared';

// Документ для просмотра (лист дерева РД — «шифр»).
export interface RdDocPayload {
  id: string;
  name: string;
  code: string | null;
  pdfStatus?: string;
}

// Узел дерева РД с текстом для поиска; у листьев — нагрузка документа.
export interface RdDataNode extends DataNode {
  nodeKind: RdTreeNode['type'];
  searchText: string;
  doc?: RdDocPayload;
  children?: RdDataNode[];
}

export function mapRdTreeToNodes(tree: RdTreeNode[]): RdDataNode[] {
  return tree.map((n): RdDataNode => {
    const title = n.code && n.code !== n.name ? `[${n.code}] ${n.name}` : n.name;
    const base: RdDataNode = {
      key: `rd:${n.id}`,
      nodeKind: n.type,
      selectable: false,
      title,
      searchText: `${n.name} ${n.code ?? ''}`.toLowerCase(),
    };
    if (n.type === 'document') {
      base.isLeaf = true;
      base.doc = { id: n.id, name: n.name, code: n.code, pdfStatus: n.pdfStatus };
    } else {
      base.children = mapRdTreeToNodes(n.children ?? []);
    }
    return base;
  });
}

// Фильтрация по подстроке — тот же алгоритм, что filterRateNodes в treeMappers.ts
// (узлы-предки сохраняются при совпадении потомков, возвращаются ключи для раскрытия).
export function filterRdNodes(
  nodes: RdDataNode[],
  query: string,
): { nodes: RdDataNode[]; expandedKeys: string[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { nodes, expandedKeys: [] };

  const expanded: string[] = [];
  const walk = (list: RdDataNode[]): RdDataNode[] => {
    const out: RdDataNode[] = [];
    for (const n of list) {
      if (n.children?.length) {
        const kids = walk(n.children);
        if (kids.length) {
          expanded.push(String(n.key));
          out.push({ ...n, children: kids });
        } else if (n.searchText.includes(q)) {
          out.push(n);
        }
      } else if (n.searchText.includes(q)) {
        out.push(n);
      }
    }
    return out;
  };

  return { nodes: walk(nodes), expandedKeys: expanded };
}

export function collectRdExpandableKeys(nodes: RdDataNode[]): Key[] {
  const out: Key[] = [];
  const walk = (list: RdDataNode[]) => {
    for (const n of list) {
      if (n.children?.length) {
        out.push(n.key as Key);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}
