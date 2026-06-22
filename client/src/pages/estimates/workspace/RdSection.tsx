import { useMemo, useState } from 'react';
import type { Key, ReactNode } from 'react';
import { Input, Tree, Button, Tooltip, Spin, Empty } from 'antd';
import { SearchOutlined, DownOutlined, UpOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { RdTreeResponse } from '@estimat/shared';
import { api } from '../../../services/api';
import { SectionShell } from './SectionShell';
import {
  mapRdTreeToNodes,
  filterRdNodes,
  collectRdExpandableKeys,
  type RdDataNode,
  type RdDocPayload,
} from './rdTreeMappers';
import { RdDocumentViewer } from './RdDocumentViewer';

interface Props {
  collapsed?: boolean;
  onToggle?: () => void;
}

const LEVEL_BADGES: Record<string, string> = {
  project: 'Объект',
  stage: 'Стадия',
  section: 'Раздел',
};

// «Рабочая документация»: дерево распознанных документов из портала RDLOCAL
// (объект → стадия РД/ПД → раздел → шифр). Клик по шифру открывает просмотр
// (markdown, файлы, кропы). Данные read-only, напрямую из внешней БД.
export function RdSection({ collapsed, onToggle }: Props) {
  const [search, setSearch] = useState('');
  const [userExpanded, setUserExpanded] = useState<Key[]>([]);
  const [viewerDoc, setViewerDoc] = useState<RdDocPayload | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rd-tree'],
    queryFn: () => api.get<RdTreeResponse>('/rd/tree'),
    staleTime: 5 * 60_000,
  });

  const configured = data?.configured ?? true;
  const nodes = useMemo(() => mapRdTreeToNodes(data?.data ?? []), [data]);
  const allExpandableKeys = useMemo(() => collectRdExpandableKeys(nodes), [nodes]);
  const { nodes: treeData, expandedKeys: autoExpand } = useMemo(
    () => filterRdNodes(nodes, search),
    [nodes, search],
  );
  const searching = search.trim().length > 0;

  const titleRender = (node: RdDataNode): ReactNode => {
    if (node.nodeKind === 'document' && node.doc) {
      const d = node.doc;
      return (
        <div
          className="estimat-tree-leaf"
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', cursor: 'pointer' }}
          onClick={() => setViewerDoc(d)}
          title="Открыть документ"
        >
          <FileTextOutlined style={{ color: '#1677ff', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>
            {node.title as string}
          </span>
        </div>
      );
    }
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: node.nodeKind === 'project' ? 600 : 400 }}>{node.title as string}</span>
        <span className="estimat-tree-badge">{LEVEL_BADGES[node.nodeKind] ?? node.nodeKind}</span>
      </span>
    );
  };

  return (
    <SectionShell
      title="Рабочая документация"
      meta={!isLoading && !configured ? 'не настроено' : undefined}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin />
        </div>
      ) : !configured ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 12.5, color: '#8c8c8c' }}>
              Портал РД не настроен. Заполните переменные RD_* в .env сервера.
            </span>
          }
          style={{ marginTop: 12 }}
        />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <Input
              allowClear
              size="small"
              prefix={<SearchOutlined />}
              placeholder="Поиск документа…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <Tooltip title="Развернуть всё">
              <Button size="small" icon={<DownOutlined />} onClick={() => setUserExpanded(allExpandableKeys)} />
            </Tooltip>
            <Tooltip title="Свернуть всё">
              <Button size="small" icon={<UpOutlined />} onClick={() => setUserExpanded([])} />
            </Tooltip>
          </div>
          {treeData.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={searching ? 'Ничего не найдено' : 'Распознанных документов нет'}
            />
          ) : (
            <Tree<RdDataNode>
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
        </>
      )}
      <RdDocumentViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />
    </SectionShell>
  );
}
