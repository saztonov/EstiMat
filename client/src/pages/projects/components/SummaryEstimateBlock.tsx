import { Tag, Button, Empty, Space, Popconfirm } from 'antd';
import { ExportOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';
import { CostTypeGroupBlock } from '../../estimates/components/CostTypeGroupBlock';
import { buildCostTypeGroups } from '../../estimates/components/types';
import type { EstimateItem, EstimateContractor } from '../../estimates/components/types';
import { formatMoney } from '../../estimates/components/types';

const statusColors: Record<string, string> = {
  draft: 'default',
  review: 'blue',
  approved: 'green',
  archived: 'orange',
};

export interface SummaryEstimate {
  id: string;
  work_type: string | null;
  status: string;
  total_amount: string;
  cost_category_id: string | null;
  cost_category_name: string | null;
  items: EstimateItem[];
  contractors: EstimateContractor[];
}

interface Props {
  estimate: SummaryEstimate;
  /** Позиции с учётом отбора (по умолчанию — все позиции сметы). */
  items?: EstimateItem[];
  /** Сумма с учётом отбора (по умолчанию — полная сумма сметы). */
  total?: number;
  index: number;
  onDelete?: (estimateId: string) => void;
}

export function SummaryEstimateBlock({ estimate, items, total, index, onDelete }: Props) {
  const navigate = useNavigate();
  const groups = buildCostTypeGroups(items ?? estimate.items ?? [], estimate.contractors ?? []);

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        marginBottom: 24,
        border: '1px solid #d6e4ff',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '14px 16px',
          background: '#f0f5ff',
          borderBottom: '1px solid #d6e4ff',
          borderRadius: '8px 8px 0 0',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 16 }}>
          Смета №{index + 1}
          {estimate.work_type ? `: ${estimate.work_type}` : ''}
        </strong>
        {estimate.cost_category_name && (
          <Tag color="geekblue">{estimate.cost_category_name}</Tag>
        )}
        <Tag color={statusColors[estimate.status]}>
          {ESTIMATE_STATUS_LABELS[estimate.status as keyof typeof ESTIMATE_STATUS_LABELS] ?? estimate.status}
        </Tag>
        <span style={{ flex: 1 }} />
        <Space>
          <span style={{ color: '#1677ff', fontWeight: 600, fontSize: 16 }}>
            {formatMoney(total ?? estimate.total_amount)}
          </span>
          <Button
            type="text"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => navigate(`/estimates/${estimate.id}`)}
            title="Открыть смету"
          />
          {onDelete && (
            <Popconfirm
              title="Удалить смету?"
              description="Все разделы и позиции будут удалены."
              okText="Удалить"
              cancelText="Отмена"
              onConfirm={() => onDelete(estimate.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} title="Удалить смету" />
            </Popconfirm>
          )}
        </Space>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {groups.length === 0 ? (
          <Empty description="В смете нет работ" style={{ padding: '20px 0' }} />
        ) : (
          groups.map((group, i) => (
            <CostTypeGroupBlock
              key={group.costTypeId ?? '__none__'}
              group={group}
              index={i}
              editable={false}
              collapsible
              defaultCollapsed
            />
          ))
        )}
      </div>
    </div>
  );
}
