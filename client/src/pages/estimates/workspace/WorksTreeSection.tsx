import { useMemo, useState, useRef } from 'react';
import type { Key, ReactNode } from 'react';
import { Input, Tree, Button, Tooltip, Spin, Empty } from 'antd';
import { SearchOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { SectionShell } from './SectionShell';
import { mapRatesTreeToNodes, filterRateNodes, type RateTreeNode } from './treeMappers';
import type { RateTreeCategory, RateLeafPayload } from './types';

interface Props {
  onAddRate: (payload: RateLeafPayload) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

// Справочник «Наименования работ»: дерево Категория → Вид работ → Наименование.
// Перенос в смету: двойной клик по наименованию ИЛИ кнопка «+» при наведении.
export function WorksTreeSection({ onAddRate, collapsed, onToggle }: Props) {
  const [search, setSearch] = useState('');
  const [userExpanded, setUserExpanded] = useState<Key[]>([]);
  const lastAdd = useRef<{ id: string; ts: number }>({ id: '', ts: 0 });

  const { data, isLoading } = useQuery({
    queryKey: ['rates-tree'],
    queryFn: () => api.get<{ data: RateTreeCategory[] }>('/rates/tree'),
  });

  const nodes = useMemo(() => mapRatesTreeToNodes(data?.data ?? []), [data]);
  const { nodes: treeData, expandedKeys: autoExpand } = useMemo(
    () => filterRateNodes(nodes, search),
    [nodes, search],
  );
  const searching = search.trim().length > 0;

  // защита от двойного добавления одной расценки подряд (клик + дабл-клик)
  function handleAdd(p: RateLeafPayload) {
    const now = Date.now();
    if (lastAdd.current.id === p.rateId && now - lastAdd.current.ts < 600) return;
    lastAdd.current = { id: p.rateId, ts: now };
    onAddRate(p);
  }

  const titleRender = (node: RateTreeNode): ReactNode => {
    if (node.nodeKind === 'rate' && node.payload) {
      const p = node.payload;
      return (
        <div
          className="estimat-tree-leaf"
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}
          onDoubleClick={() => handleAdd(p)}
          title="Двойной клик — добавить в смету"
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name} · {p.unit}
          </span>
          <span style={{ color: '#8c8c8c', fontSize: 12, whiteSpace: 'nowrap' }}>
            {p.price.toLocaleString('ru-RU')} ₽
          </span>
          <Tooltip title="Добавить в смету">
            <Button
              className="estimat-tree-add"
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleAdd(p);
              }}
            />
          </Tooltip>
        </div>
      );
    }
    const badge = node.nodeKind === 'cat' ? 'Категория' : 'Вид работ';
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: node.nodeKind === 'cat' ? 600 : 400 }}>{node.title as string}</span>
        <span className="estimat-tree-badge">{badge}</span>
      </span>
    );
  };

  return (
    <SectionShell
      title="Наименования работ"
      meta="Категория · Вид работ · Наименование"
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <Input
        allowClear
        size="small"
        prefix={<SearchOutlined />}
        placeholder="Поиск работы…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin />
        </div>
      ) : treeData.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено" />
      ) : (
        <Tree<RateTreeNode>
          className="estimat-ref-tree"
          treeData={treeData}
          blockNode
          selectable={false}
          titleRender={titleRender}
          expandedKeys={searching ? autoExpand : userExpanded}
          onExpand={(keys) => {
            if (!searching) setUserExpanded(keys);
          }}
        />
      )}
    </SectionShell>
  );
}
