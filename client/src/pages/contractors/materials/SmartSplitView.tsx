import { Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { OnCostTypeCiphers } from './CostTypeCiphersModal';
import type { SplitLeafRow, SplitNode } from './smartSplit';

const qty = (v: number) => Math.round(v * 1e4) / 1e4;

interface Props {
  nodes: SplitNode[];
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  /** Клик по названию вида работ — показать его шифры РД (узел при этом не сворачивается). */
  onCostTypeCiphers: OnCostTypeCiphers;
  depth?: number;
}

// Разбивка ИИ-блока по корпусам/этажам/виду работ. Форма подуровня — как в дереве стандартной
// группировки: заголовок со стрелкой и отступом, без вложенных рамок (матрёшка из карточек читается
// хуже). На листе — компактная таблица «Материал · Ед · Кол-во по смете» в этом срезе; «Заказано» и
// «Остаток» тут не показываются: они живут на атомарной строке (у заявок нет разреза по корпусам).
const leafColumns: ColumnsType<SplitLeafRow> = [
  { title: 'Материал', key: 'name', render: (_v, r) => r.row.name },
  { title: 'Ед.', key: 'unit', width: 80, render: (_v, r) => r.row.unit },
  {
    title: 'Кол-во по смете',
    key: 'quantity',
    width: 160,
    align: 'right',
    render: (_v, r) => qty(r.quantity),
  },
];

function nodeTitle(node: SplitNode): string {
  if (node.level === 'location') {
    const parts = [...node.badges!.zoneNames];
    if (node.badges!.floorsLabel) parts.push(`эт. ${node.badges!.floorsLabel}`);
    return parts.filter(Boolean).join(' ') || node.label;
  }
  if (node.level === 'locationType') return `Тип: ${node.label}`;
  return node.label;
}

export function SmartSplitView({ nodes, collapsed, onToggle, onCostTypeCiphers, depth = 0 }: Props) {
  return (
    <>
      {nodes.map((node) => {
        const isCollapsed = collapsed.has(node.key);
        // Название вида работ открывает шифры, остальная площадь заголовка сворачивает узел.
        const heading =
          node.level === 'costType' ? (
            <Tooltip title="Показать шифры рабочей документации">
              <strong
                style={{ fontSize: 13, cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCostTypeCiphers({ costTypeId: node.costTypeId, costTypeName: node.label });
                }}
              >
                {nodeTitle(node)}
              </strong>
            </Tooltip>
          ) : (
            <strong style={{ fontSize: 13 }}>{nodeTitle(node)}</strong>
          );
        return (
          <div key={node.key} style={{ marginLeft: depth * 16, marginBottom: 6 }}>
            <div
              onClick={() => onToggle(node.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 0' }}
            >
              {isCollapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
              {heading}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {node.rowCount} поз.
              </Typography.Text>
            </div>
            {!isCollapsed &&
              (node.children.length > 0 ? (
                <SmartSplitView
                  nodes={node.children}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onCostTypeCiphers={onCostTypeCiphers}
                  depth={depth + 1}
                />
              ) : (
                <div style={{ marginLeft: 16 }}>
                  <Table<SplitLeafRow>
                    rowKey={(r) => r.row.orderKey}
                    size="small"
                    pagination={false}
                    dataSource={node.leaves}
                    columns={leafColumns}
                  />
                </div>
              ))}
          </div>
        );
      })}
    </>
  );
}
