import { Tag, Button, Empty, Space } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';
import { SectionBlock } from '../../estimates/components/SectionBlock';
import type { EstimateSection } from '../../estimates/components/types';
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
  sections: EstimateSection[];
}

interface Props {
  estimate: SummaryEstimate;
  index: number;
}

const noopAsync = async () => {};
const noop = () => {};

export function SummaryEstimateBlock({ estimate, index }: Props) {
  const navigate = useNavigate();

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
            {formatMoney(estimate.total_amount)}
          </span>
          <Button
            type="text"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => navigate(`/estimates/${estimate.id}`)}
            title="Открыть смету"
          />
        </Space>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {estimate.sections.length === 0 ? (
          <Empty description="В смете нет разделов" style={{ padding: '20px 0' }} />
        ) : (
          estimate.sections.map((section, i) => (
            <SectionBlock
              key={section.id}
              section={section}
              index={i}
              editable={false}
              collapsible
              defaultCollapsed
              onCreateItem={noopAsync}
              onUpdateItem={noopAsync}
              onDeleteItem={noop}
              onEditSection={noop}
              onDeleteSection={noop}
            />
          ))
        )}
      </div>
    </div>
  );
}
