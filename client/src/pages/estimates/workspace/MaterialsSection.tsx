import { useMemo, useRef, useState } from 'react';
import type { Key, ReactNode } from 'react';
import { Input, Tree, Spin, Empty, App, Button, Tooltip } from 'antd';
import { SearchOutlined, PlusOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { useEstimateSelectionStore } from '../../../store/estimateSelectionStore';
import { SectionShell } from './SectionShell';
import type { SaveMaterialPayload } from '../components/CostTypeGroupBlock';
import type { MaterialRef } from './types';

const UNGROUPED = '__ungrouped__';

interface MatNode extends DataNode {
  searchText: string;
  material?: MaterialRef;
  children?: MatNode[];
}

interface Props {
  onAddMaterial: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  collapsed?: boolean;
  onToggle?: () => void;
}

// Каталог материалов: Группа → Материал, с поиском. Сейчас панель —
// браузер справочника; материалы в смету добавляются под работой кнопкой
// «Материал» (нужна активная работа). Двойной клик / «+» подсказывают это.
export function MaterialsSection({ onAddMaterial, collapsed, onToggle }: Props) {
  const { message } = App.useApp();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Key[]>([]);
  const selectedWorkId = useEstimateSelectionStore((s) => s.selectedWorkId);
  const selectedWorkLabel = useEstimateSelectionStore((s) => s.selectedWorkLabel);
  const lastAdd = useRef<{ id: string; ts: number }>({ id: '', ts: 0 });

  const { data, isLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<{ data: MaterialRef[] }>('/materials'),
  });

  const allNodes = useMemo<MatNode[]>(() => {
    const list = data?.data ?? [];
    const groups = new Map<string, { name: string; items: MaterialRef[] }>();
    for (const m of list) {
      const key = m.group_id ?? UNGROUPED;
      if (!groups.has(key)) groups.set(key, { name: m.group_name ?? 'Без группы', items: [] });
      groups.get(key)!.items.push(m);
    }
    return [...groups.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru'))
      .map(([gid, g]) => ({
        key: `g:${gid}`,
        selectable: false,
        title: g.name,
        searchText: g.name.toLowerCase(),
        children: g.items.map((m) => ({
          key: `m:${m.id}`,
          isLeaf: true,
          selectable: false,
          title: `${m.name} · ${m.unit} · ${Number(m.unit_price ?? 0).toLocaleString('ru-RU')} ₽`,
          searchText: m.name.toLowerCase(),
          material: m,
        })),
      }));
  }, [data]);

  const allGroupKeys = useMemo<Key[]>(() => allNodes.map((g) => g.key as Key), [allNodes]);

  const { treeData, autoExpand } = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { treeData: allNodes, autoExpand: [] as string[] };
    const exp: string[] = [];
    const out: MatNode[] = [];
    for (const g of allNodes) {
      const kids = (g.children ?? []).filter((c) => c.searchText.includes(q));
      if (kids.length) {
        exp.push(String(g.key));
        out.push({ ...g, children: kids });
      } else if (g.searchText.includes(q)) {
        out.push(g);
      }
    }
    return { treeData: out, autoExpand: exp };
  }, [allNodes, search]);

  const searching = search.trim().length > 0;

  // Добавить материал из справочника к выделенной работе.
  // Защита от двойного добавления подряд (клик + дабл-клик).
  function addToWork(m?: MaterialRef) {
    if (!m) return;
    if (!selectedWorkId) {
      message.info('Сначала выделите работу в смете — материал добавится к ней.');
      return;
    }
    const now = Date.now();
    if (lastAdd.current.id === m.id && now - lastAdd.current.ts < 600) return;
    lastAdd.current = { id: m.id, ts: now };
    void onAddMaterial(selectedWorkId, {
      materialId: m.id,
      description: m.name,
      unit: m.unit,
      quantity: 1,
      unitPrice: Number(m.unit_price ?? 0),
    });
  }

  const titleRender = (node: MatNode): ReactNode => {
    if (!node.isLeaf) {
      return <span style={{ fontWeight: 600 }}>{node.title as string}</span>;
    }
    return (
      <div
        className="estimat-tree-leaf"
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}
        onDoubleClick={() => addToWork(node.material)}
        title="Двойной клик — добавить к выделенной работе"
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.title as string}
        </span>
        <Tooltip title="Добавить к выделенной работе">
          <Button
            className="estimat-tree-add"
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              addToWork(node.material);
            }}
          />
        </Tooltip>
      </div>
    );
  };

  const meta = selectedWorkLabel
    ? `→ ${selectedWorkLabel.length > 40 ? selectedWorkLabel.slice(0, 40) + '…' : selectedWorkLabel}`
    : 'Группа · Наименование';

  return (
    <SectionShell title="Материалы" meta={meta} collapsed={collapsed} onToggle={onToggle}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Поиск материала…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <Tooltip title="Развернуть всё">
          <Button size="small" icon={<DownOutlined />} onClick={() => setExpanded(allGroupKeys)} />
        </Tooltip>
        <Tooltip title="Свернуть всё">
          <Button size="small" icon={<UpOutlined />} onClick={() => setExpanded([])} />
        </Tooltip>
      </div>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin />
        </div>
      ) : treeData.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено" />
      ) : (
        <Tree<MatNode>
          className="estimat-ref-tree"
          treeData={treeData}
          blockNode
          selectable={false}
          titleRender={titleRender}
          expandedKeys={searching ? autoExpand : expanded}
          onExpand={(keys) => {
            if (!searching) setExpanded(keys);
          }}
        />
      )}
    </SectionShell>
  );
}
