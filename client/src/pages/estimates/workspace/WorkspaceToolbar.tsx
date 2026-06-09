import type { ReactNode } from 'react';
import { Button, Tag, Space, Tooltip, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  PlusOutlined,
  EditOutlined,
  TableOutlined,
  RobotOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';
import type { EstimateDetail } from '../components/types';
import { formatMoney } from '../components/types';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';

const statusColors: Record<string, string> = {
  draft: 'default',
  review: 'blue',
  approved: 'green',
  archived: 'orange',
};

interface Props {
  estimate: EstimateDetail;
  totalItems: number;
  groupCount: number;
  isDraft: boolean;
  onBack: () => void;
  onEdit: () => void;
  onAddCostType: () => void;
  onChangeStatus: (status: string) => void;
}

// Кнопка-переключатель области («горящая» когда активна)
function AreaToggle({
  active,
  locked,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  locked?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const btn = (
    <Button
      type={active ? 'primary' : 'default'}
      icon={icon}
      disabled={locked}
      onClick={locked ? undefined : onClick}
      style={locked ? { opacity: 1, cursor: 'not-allowed' } : undefined}
    >
      {label}
    </Button>
  );
  return locked ? <Tooltip title="Сметная часть всегда включена">{btn}</Tooltip> : btn;
}

export function WorkspaceToolbar({
  estimate,
  totalItems,
  groupCount,
  isDraft,
  onBack,
  onEdit,
  onAddCostType,
  onChangeStatus,
}: Props) {
  const { visibility, toggleArea } = useWorkspaceLayoutStore();
  const statusLabel = ESTIMATE_STATUS_LABELS[estimate.status as keyof typeof ESTIMATE_STATUS_LABELS];
  const title = estimate.work_type || 'Смета';

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
        К объекту
      </Button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Typography.Text strong style={{ fontSize: 15, whiteSpace: 'nowrap' }}>
          {title}
        </Typography.Text>
        <Tag color={statusColors[estimate.status]} style={{ marginInlineEnd: 0 }}>
          {statusLabel}
        </Tag>
        <Typography.Text type="secondary" ellipsis style={{ fontSize: 12.5, maxWidth: 260 }}>
          {estimate.project_code} · {estimate.project_name}
        </Typography.Text>
      </div>

      <span style={{ color: '#1677ff', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {formatMoney(estimate.total_amount)}
      </span>
      <Typography.Text type="secondary" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
        Работ: {totalItems} · Видов затрат: {groupCount}
      </Typography.Text>

      <span style={{ flex: 1 }} />

      <Button type="dashed" icon={<PlusOutlined />} onClick={onAddCostType}>
        Вид затрат
      </Button>
      <Button type="text" icon={<EditOutlined />} onClick={onEdit} />
      {isDraft && (
        <Button type="primary" icon={<CheckOutlined />} onClick={() => onChangeStatus('review')}>
          На проверку
        </Button>
      )}
      {estimate.status === 'review' && (
        <Button type="primary" icon={<CheckOutlined />} onClick={() => onChangeStatus('approved')}>
          Утвердить
        </Button>
      )}

      <span style={{ width: 1, height: 22, background: '#f0f0f0', margin: '0 2px' }} />

      <Space size={8}>
        <AreaToggle active locked icon={<TableOutlined />} label="Сметная часть" />
        <AreaToggle
          active={visibility.ai}
          icon={<RobotOutlined />}
          label="ИИ часть"
          onClick={() => toggleArea('ai')}
        />
        <AreaToggle
          active={visibility.refs}
          icon={<AppstoreOutlined />}
          label="Справочники"
          onClick={() => toggleArea('refs')}
        />
      </Space>
    </div>
  );
}
