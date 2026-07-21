import { useMemo, useRef, useState } from 'react';
import { Col, Empty, Input, Row, Space, Spin, Table, Tag, Tree, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import {
  mapRatesTreeToNodes,
  filterRateNodes,
  type RateTreeNode,
} from '../estimates/workspace/treeMappers';
import type { RateTreeCategory } from '../estimates/workspace/types';

// Работа нового справочника (rates_v2) в дереве /api/rates-v2/tree
interface V2Rate {
  id: string;
  cost_type_id: string;
  name: string;
  unit: string;
  legacy_rate_id: string | null;
  legacy_rate_name: string | null;
  match_kind: 'matched' | 'probable' | null;
  source_projects: number;
  source_files: number;
  materials_count: number;
}

interface V2TreeType {
  id: string;
  category_id: string;
  name: string;
  rates: V2Rate[];
}

interface V2TreeCategory {
  id: string;
  name: string;
  types: V2TreeType[];
}

interface V2Material {
  id: string;
  material_id: string;
  name: string;
  unit: string;
  qty_ratio: string;
  files_count: number;
  projects_count: number;
}

interface V2TreeNode extends RateTreeNode {
  v2?: V2Rate;
}

// Дерево нового справочника: бейджи числа материалов и вида связи со старым справочником
function mapV2TreeToNodes(tree: V2TreeCategory[]): V2TreeNode[] {
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
      children: t.rates.map(
        (r): V2TreeNode => ({
          key: `rate:${r.id}`,
          nodeKind: 'rate',
          isLeaf: true,
          v2: r,
          title: r.name,
          searchText: r.name.toLowerCase(),
        }),
      ),
    })),
  }));
}

// Путь (категория, вид) к расценке старого справочника — для раскрытия левого дерева
function findLegacyPath(
  tree: RateTreeCategory[] | undefined,
  rateId: string,
): { catKey: string; typeKey: string; rateKey: string } | null {
  for (const cat of tree ?? []) {
    for (const t of cat.types) {
      if (t.rates.some((r) => r.id === rateId)) {
        // Ключ листа составной (вид+работа) — работа может висеть под несколькими видами.
        return { catKey: `cat:${cat.id}`, typeKey: `type:${t.id}`, rateKey: `rate:${t.id}:${rateId}` };
      }
    }
  }
  return null;
}

const MATCH_TAG = {
  matched: { color: 'green', text: 'связана' },
  probable: { color: 'orange', text: 'вероятно' },
} as const;

export function CatalogComparePanel() {
  const [leftSearch, setLeftSearch] = useState('');
  const [rightSearch, setRightSearch] = useState('');
  const [leftExpanded, setLeftExpanded] = useState<string[]>([]);
  const [rightExpanded, setRightExpanded] = useState<string[]>([]);
  const [leftSelectedKeys, setLeftSelectedKeys] = useState<string[]>([]);
  const [selectedWork, setSelectedWork] = useState<V2Rate | null>(null);
  const leftTreeRef = useRef<{ scrollTo: (opts: { key: string }) => void }>(null);

  const { data: legacyTree, isLoading: legacyLoading } = useQuery({
    queryKey: ['rates-tree'],
    queryFn: () => api.get<{ data: RateTreeCategory[] }>('/rates/tree'),
  });
  const { data: v2Tree, isLoading: v2Loading } = useQuery({
    queryKey: ['rates-v2-tree'],
    queryFn: () => api.get<{ data: V2TreeCategory[] }>('/rates-v2/tree'),
  });
  const { data: materials, isFetching: materialsLoading } = useQuery({
    queryKey: ['rates-v2-materials', selectedWork?.id],
    queryFn: () => api.get<{ data: V2Material[] }>(`/rates-v2/${selectedWork!.id}/materials`),
    enabled: !!selectedWork,
  });

  const leftNodes = useMemo(() => mapRatesTreeToNodes(legacyTree?.data ?? []), [legacyTree]);
  const rightNodes = useMemo(() => mapV2TreeToNodes(v2Tree?.data ?? []), [v2Tree]);

  const leftFiltered = useMemo(() => filterRateNodes(leftNodes, leftSearch), [leftNodes, leftSearch]);
  const rightFiltered = useMemo(
    () => filterRateNodes(rightNodes, rightSearch) as { nodes: V2TreeNode[]; expandedKeys: string[] },
    [rightNodes, rightSearch],
  );

  // Клик по работе нового справочника: показать материалы; если есть связь со
  // старым справочником — раскрыть и подсветить расценку в левом дереве.
  function handleSelectWork(work: V2Rate) {
    setSelectedWork(work);
    if (work.legacy_rate_id) {
      const path = findLegacyPath(legacyTree?.data, work.legacy_rate_id);
      if (path) {
        setLeftExpanded((prev) => [...new Set([...prev, path.catKey, path.typeKey])]);
        setLeftSelectedKeys([path.rateKey]);
        setTimeout(() => leftTreeRef.current?.scrollTo({ key: path.rateKey }), 100);
        return;
      }
    }
    setLeftSelectedKeys([]);
  }

  const materialColumns: ColumnsType<V2Material> = [
    { title: 'Типовой материал', dataIndex: 'name' },
    { title: 'Ед.', dataIndex: 'unit', width: 70, align: 'center' },
    {
      title: 'Расход на ед. работы',
      dataIndex: 'qty_ratio',
      width: 150,
      align: 'right',
      render: (v: string) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 4 }),
    },
    { title: 'Проектов', dataIndex: 'projects_count', width: 90, align: 'center' },
    { title: 'ВОР', dataIndex: 'files_count', width: 70, align: 'center' },
  ];

  const treeBoxStyle: React.CSSProperties = {
    border: '1px solid var(--est-border)',
    borderRadius: 8,
    padding: 8,
    background: 'var(--est-bg-container)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1, overflow: 'auto' }}>
      <Row gutter={12}>
        <Col span={12}>
          <div style={treeBoxStyle}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Typography.Text strong>Существующий справочник</Typography.Text>
              <Input.Search
                allowClear
                placeholder="Поиск по работам"
                value={leftSearch}
                onChange={(e) => setLeftSearch(e.target.value)}
              />
              {legacyLoading ? (
                <Spin />
              ) : (
                <Tree<RateTreeNode>
                  ref={leftTreeRef as never}
                  height={440}
                  treeData={leftFiltered.nodes}
                  expandedKeys={leftSearch ? leftFiltered.expandedKeys : leftExpanded}
                  onExpand={(keys) => setLeftExpanded(keys.map(String))}
                  selectedKeys={leftSelectedKeys}
                  showLine
                />
              )}
            </Space>
          </div>
        </Col>
        <Col span={12}>
          <div style={treeBoxStyle}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Typography.Text strong>Новый справочник (из ВОР)</Typography.Text>
              <Input.Search
                allowClear
                placeholder="Поиск по работам"
                value={rightSearch}
                onChange={(e) => setRightSearch(e.target.value)}
              />
              {v2Loading ? (
                <Spin />
              ) : rightNodes.length === 0 ? (
                <Empty description="Новый справочник пуст — выполните импорт (db:import-vor)" />
              ) : (
                <Tree<V2TreeNode>
                  height={440}
                  treeData={rightFiltered.nodes}
                  expandedKeys={rightSearch ? rightFiltered.expandedKeys : rightExpanded}
                  onExpand={(keys) => setRightExpanded(keys.map(String))}
                  selectedKeys={selectedWork ? [`rate:${selectedWork.id}`] : []}
                  onSelect={(_keys, info) => {
                    const node = info.node as unknown as V2TreeNode;
                    if (node.v2) handleSelectWork(node.v2);
                  }}
                  showLine
                  titleRender={(node) => {
                    const n = node as V2TreeNode;
                    if (!n.v2) return <span>{n.title as string}</span>;
                    const match = n.v2.match_kind ? MATCH_TAG[n.v2.match_kind] : null;
                    const isNew = !n.v2.legacy_rate_id && !n.v2.match_kind;
                    return (
                      <Space size={6}>
                        <span>{n.v2.name}</span>
                        <Tag style={{ marginInlineEnd: 0 }}>{n.v2.unit}</Tag>
                        {isNew && (
                          <Tag color="red" style={{ marginInlineEnd: 0 }}>
                            новая
                          </Tag>
                        )}
                        {n.v2.materials_count > 0 && (
                          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                            мат.: {n.v2.materials_count}
                          </Tag>
                        )}
                        {match && (
                          <Tag color={match.color} style={{ marginInlineEnd: 0 }}>
                            {match.text}
                          </Tag>
                        )}
                      </Space>
                    );
                  }}
                />
              )}
            </Space>
          </div>
        </Col>
      </Row>

      {selectedWork && (
        <div style={treeBoxStyle}>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Space size={8} wrap>
              <Typography.Text strong>Типовые материалы:</Typography.Text>
              <Typography.Text>{selectedWork.name}</Typography.Text>
              <Tag>{selectedWork.unit}</Tag>
              <Typography.Text type="secondary">
                встречается в {selectedWork.source_projects} проектах / {selectedWork.source_files} ВОР
              </Typography.Text>
              {selectedWork.legacy_rate_name && (
                <Typography.Text type="secondary">
                  ↔ старый справочник: {selectedWork.legacy_rate_name}
                  {selectedWork.match_kind === 'probable' ? ' (вероятное совпадение)' : ''}
                </Typography.Text>
              )}
            </Space>
            <Table
              rowKey="id"
              size="small"
              columns={materialColumns}
              dataSource={materials?.data ?? []}
              loading={materialsLoading}
              pagination={false}
              locale={{ emptyText: 'Типовых материалов нет (редкие материалы в справочник не заносятся)' }}
            />
          </Space>
        </div>
      )}
    </div>
  );
}
