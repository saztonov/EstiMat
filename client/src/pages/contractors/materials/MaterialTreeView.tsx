import { useMemo } from 'react';
import { Table, Space, Tooltip } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { LocationBadgesRow } from '../../estimates/components/LocationBadges';
import { formatMoney } from '../../estimates/components/types';
import type { OnCostTypeCiphers } from './CostTypeCiphersModal';
import { locationBadgeKey, withLocationSpans } from './locationSpans';
import type { MaterialTreeNode } from './materialTree';
import type { OrderMaterialRow } from './orderRow';
import { subtreeRows } from './draftFill';
import { GroupCard } from './GroupCard';
import { GroupFillButton } from './GroupFillButton';

/** Массовый набор: включён только в режиме заявки. Доля фиксирована — набирают весь остаток. */
export interface BulkFill {
  /** key узла дерева → сколько строк его поддерева уже в заявке (один обход, buildDraftIndex). */
  draftIndex: Map<string, number>;
  /** Количества черновика по ключу заказа — для ИИ-групп: узлов дерева у них нет. */
  draftValues: Map<string, number>;
  onFill: (rows: OrderMaterialRow[]) => void;
  onClear: (rows: OrderMaterialRow[]) => void;
}

interface Props {
  nodes: MaterialTreeNode[];
  columns: ColumnsType<OrderMaterialRow>;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  bulk?: BulkFill;
  rowClassName?: (row: OrderMaterialRow) => string;
  /** Клик по названию вида работ — показать его шифры РД (узел при этом не сворачивается). */
  onCostTypeCiphers: OnCostTypeCiphers;
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

const HEAD_FONT = [14, 13, 12, 12];

/**
 * Итог узла в ₽ — только по строкам с известной ценой закупки. Без единой цены суммы нет вовсе
 * (не «0 ₽»), при неполном покрытии честно пишем, сколько позиций оценено.
 */
function NodeTotal({ node }: { node: MaterialTreeNode }) {
  if (node.pricedRowCount === 0) return null;
  return (
    <>
      <span style={{ color: 'var(--est-primary)' }}>{formatMoney(node.total)}</span>
      {node.pricedRowCount < node.rowCount && (
        <span style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>
          оценено {node.pricedRowCount} из {node.rowCount}
        </span>
      )}
    </>
  );
}

// Дерево группировки. Ветки рендерятся лениво: содержимое свёрнутого узла не строится вовсе —
// при всех включённых уровнях узлов сотни, и разом они дали бы сотни таблиц.
export function MaterialTreeView({
  nodes,
  columns,
  collapsed,
  onToggle,
  bulk,
  rowClassName,
  onCostTypeCiphers,
}: Props) {
  // Отступ между корневыми блоками задаёт сама карточка — обёртка со своим size его бы удвоила.
  return (
    <div>
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
          onCostTypeCiphers={onCostTypeCiphers}
        />
      ))}
    </div>
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
  onCostTypeCiphers,
}: {
  node: MaterialTreeNode;
  depth: number;
} & Omit<Props, 'nodes'>) {
  const isCollapsed = collapsed.has(node.key);
  const headFont = HEAD_FONT[Math.min(depth, HEAD_FONT.length - 1)];
  // Объединение ячеек местоположения считается по строкам ИМЕННО этой таблицы: rowSpan привязан
  // к порядку dataSource и через границы таблиц не переносится.
  const cols = useMemo(
    () => withLocationSpans(columns, node.materials, locationBadgeKey),
    [columns, node.materials],
  );

  // Уровни «Локация» и «Тип работы» без подписи читались как случайные бейджи: из заголовка
  // не было видно, по какому признаку разделены материалы.
  const title = node.badges ? (
    <>
      <span style={{ color: 'var(--est-text-tertiary)', fontSize: 13 }}>Местоположение:</span>
      <LocationBadgesRow
        zoneNames={node.badges.zoneNames}
        floorsLabel={node.badges.floorsLabel}
        typeLabels={[]}
      />
    </>
  ) : node.level === 'costType' ? (
    // Только название вида работ открывает шифры; остальная площадь заголовка по-прежнему
    // сворачивает узел, поэтому клик сюда до неё доходить не должен.
    <Tooltip title="Показать шифры рабочей документации">
      <strong
        style={{ fontSize: headFont, cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onCostTypeCiphers({ costTypeId: node.costTypeId, costTypeName: node.label });
        }}
      >
        {node.label}
      </strong>
    </Tooltip>
  ) : (
    <strong style={{ fontSize: headFont }}>
      {node.level === 'locationType' ? `Тип: ${node.label}` : node.label}
    </strong>
  );
  const meta = (
    <>
      <span style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>{node.rowCount} поз.</span>
      <NodeTotal node={node} />
    </>
  );
  const fillButton = bulk && (
    <GroupFillButton
      rows={subtreeRows(node)}
      draftCount={bulk.draftIndex.get(node.key) ?? 0}
      onFill={bulk.onFill}
      onClear={bulk.onClear}
    />
  );
  const body = (
    <>
      {node.materials.length > 0 && (
        <Table<OrderMaterialRow>
          rowKey="orderKey"
          size="small"
          className="estimat-compact"
          pagination={false}
          dataSource={node.materials}
          columns={cols}
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
          onCostTypeCiphers={onCostTypeCiphers}
        />
      ))}
    </>
  );

  // Карточка — только у корня: при всех включённых уровнях вложенные карточки дали бы матрёшку
  // из рамок, в которой границы читаются хуже, чем без них вовсе.
  if (depth === 0) {
    return (
      <GroupCard collapsed={isCollapsed} onToggle={() => onToggle(node.key)} title={title} meta={meta} extra={fillButton}>
        <div style={{ padding: node.children.length > 0 ? 4 : 0 }}>{body}</div>
      </GroupCard>
    );
  }

  // Ступенька вложенности 12px, а не 16: при уменьшенном шрифте заголовков она даёт тот же
  // визуальный сдвиг, но при трёх-четырёх уровнях экономит заметную ширину.
  return (
    <div style={{ marginLeft: (depth - 1) * 12, marginBottom: 4 }}>
      {/* Кликабельная часть заголовка и кнопки — сиблинги: клик по заголовку сворачивает узел,
          клик по кнопке набора до него не доходит без stopPropagation. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <Space size={6} style={{ cursor: 'pointer' }} onClick={() => onToggle(node.key)}>
          {isCollapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
          {title}
          {meta}
        </Space>
        {fillButton}
      </div>
      {!isCollapsed && body}
    </div>
  );
}
