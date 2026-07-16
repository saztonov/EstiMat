import { Table, Space } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { LocationBadgesRow } from '../../estimates/components/LocationBadges';
import { formatMoney } from '../../estimates/components/types';
import type { MaterialTreeNode } from './materialTree';
import type { OrderMaterialRow } from './orderRow';
import { subtreeRows } from './draftFill';
import { GroupFillButton } from './GroupFillButton';

/** Массовый набор: включён только в режиме заявки. */
export interface BulkFill {
  percent: number;
  /** key узла дерева → сколько строк его поддерева уже в заявке (один обход, buildDraftIndex). */
  draftIndex: Map<string, number>;
  /** Количества черновика по ключу заказа — для ИИ-групп: узлов дерева у них нет. */
  draftValues: Map<string, number>;
  onFill: (rows: OrderMaterialRow[], percent: number) => void;
  onClear: (rows: OrderMaterialRow[]) => void;
}

interface Props {
  nodes: MaterialTreeNode[];
  columns: ColumnsType<OrderMaterialRow>;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  bulk?: BulkFill;
  rowClassName?: (row: OrderMaterialRow) => string;
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

/**
 * Итог узла в ₽ — только по строкам с известной ценой закупки. Без единой цены суммы нет вовсе
 * (не «0 ₽»), при неполном покрытии честно пишем, сколько позиций оценено.
 */
function NodeTotal({ node }: { node: MaterialTreeNode }) {
  if (node.pricedRowCount === 0) return null;
  return (
    <>
      <span style={{ color: '#1677ff' }}>{formatMoney(node.total)}</span>
      {node.pricedRowCount < node.rowCount && (
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          оценено {node.pricedRowCount} из {node.rowCount}
        </span>
      )}
    </>
  );
}

// Дерево группировки. Ветки рендерятся лениво: содержимое свёрнутого узла не строится вовсе —
// при всех включённых уровнях узлов сотни, и разом они дали бы сотни таблиц.
export function MaterialTreeView({ nodes, columns, collapsed, onToggle, bulk, rowClassName }: Props) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {nodes.map((n) => (
        <TreeNodeView
          key={n.key}
          node={n}
          depth={0}
          columns={columns}
          collapsed={collapsed}
          onToggle={onToggle}
          bulk={bulk}
          rowClassName={rowClassName}
        />
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
  bulk,
  rowClassName,
}: {
  node: MaterialTreeNode;
  depth: number;
} & Omit<Props, 'nodes'>) {
  const isCollapsed = collapsed.has(node.key);
  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 8 }}>
      {/* Кликабельная часть заголовка и кнопки — сиблинги: клик по заголовку сворачивает узел,
          клик по кнопке набора до него не доходит без stopPropagation. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Space size={6} style={{ cursor: 'pointer' }} onClick={() => onToggle(node.key)}>
          {isCollapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
          {/* Уровни «Локация» и «Тип работы» без подписи читались как случайные бейджи: из заголовка
              не было видно, по какому признаку разделены материалы. */}
          {node.badges ? (
            <>
              <span style={{ color: '#8c8c8c', fontSize: 13 }}>Местоположение:</span>
              <LocationBadgesRow
                zoneNames={node.badges.zoneNames}
                floorsLabel={node.badges.floorsLabel}
                typeLabels={[]}
              />
            </>
          ) : (
            <strong style={{ fontSize: HEAD_FONT[Math.min(depth, HEAD_FONT.length - 1)] }}>
              {node.level === 'locationType' ? `Тип: ${node.label}` : node.label}
            </strong>
          )}
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{node.rowCount} поз.</span>
          <NodeTotal node={node} />
        </Space>
        {bulk && (
          <GroupFillButton
            rows={subtreeRows(node)}
            percent={bulk.percent}
            draftCount={bulk.draftIndex.get(node.key) ?? 0}
            onFill={bulk.onFill}
            onClear={bulk.onClear}
          />
        )}
      </div>
      {!isCollapsed && (
        <>
          {node.materials.length > 0 && (
            <Table<OrderMaterialRow>
              rowKey="orderKey"
              size="small"
              pagination={false}
              dataSource={node.materials}
              columns={columns}
              rowClassName={rowClassName}
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
              bulk={bulk}
              rowClassName={rowClassName}
            />
          ))}
        </>
      )}
    </div>
  );
}
