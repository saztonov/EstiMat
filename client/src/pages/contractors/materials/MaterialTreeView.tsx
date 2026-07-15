import { Table, Space } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { LocationBadgesRow } from '../../estimates/components/LocationBadges';
import { formatMoney } from '../../estimates/components/types';
import type { MaterialTreeNode } from './materialTree';
import type { OrderMaterialRow } from './orderRow';

interface Props {
  nodes: MaterialTreeNode[];
  columns: ColumnsType<OrderMaterialRow>;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}

/** Ключи всех узлов дерева — для «Свернуть всё». */
export function collectNodeKeys(nodes: MaterialTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: MaterialTreeNode[]) => {
    for (const n of list) {
      out.push(n.key);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const HEAD_FONT = [15, 14, 13, 13];

// Дерево группировки. Ветки рендерятся лениво: содержимое свёрнутого узла не строится вовсе —
// при всех включённых уровнях узлов сотни, и разом они дали бы сотни таблиц.
export function MaterialTreeView({ nodes, columns, collapsed, onToggle }: Props) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {nodes.map((n) => (
        <TreeNodeView key={n.key} node={n} depth={0} columns={columns} collapsed={collapsed} onToggle={onToggle} />
      ))}
    </Space>
  );
}

function TreeNodeView({
  node,
  depth,
  columns,
  collapsed,
  onToggle,
}: {
  node: MaterialTreeNode;
  depth: number;
} & Omit<Props, 'nodes'>) {
  const isCollapsed = collapsed.has(node.key);
  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 8 }}>
      <Space
        size={6}
        style={{ cursor: 'pointer', marginBottom: 8 }}
        onClick={() => onToggle(node.key)}
      >
        {isCollapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
        {node.badges ? (
          <LocationBadgesRow
            zoneNames={node.badges.zoneNames}
            floorsLabel={node.badges.floorsLabel}
            typeLabels={[]}
          />
        ) : (
          <strong style={{ fontSize: HEAD_FONT[Math.min(depth, HEAD_FONT.length - 1)] }}>{node.label}</strong>
        )}
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>{node.rowCount} поз.</span>
        <span style={{ color: '#1677ff' }}>{formatMoney(node.total)}</span>
      </Space>
      {!isCollapsed && (
        <>
          {node.materials.length > 0 && (
            <Table<OrderMaterialRow>
              rowKey="orderKey"
              size="small"
              pagination={false}
              dataSource={node.materials}
              columns={columns}
              scroll={{ x: 1100 }}
            />
          )}
          {node.children.map((c) => (
            <TreeNodeView
              key={c.key}
              node={c}
              depth={depth + 1}
              columns={columns}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </div>
  );
}
