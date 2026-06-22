import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button, Space, Tooltip, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  PlusOutlined,
  EditOutlined,
  TableOutlined,
  RobotOutlined,
  AppstoreOutlined,
  HistoryOutlined,
  ContainerOutlined,
} from '@ant-design/icons';
import type { EstimateDetail } from '../components/types';
import { formatMoney } from '../components/types';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { AiProcessingIndicator } from './AiProcessingIndicator';

interface Props {
  estimate: EstimateDetail;
  totalItems: number;
  groupCount: number;
  onBack: () => void;
  onEdit: () => void;
  onAddCostType: () => void;
  onHistory: () => void;
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
  onBack,
  onEdit,
  onAddCostType,
  onHistory,
}: Props) {
  const { visibility, toggleArea } = useWorkspaceLayoutStore();
  const navigate = useNavigate();
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
      <Tooltip title="Свод материалов сметы">
        <Button icon={<ContainerOutlined />} onClick={() => navigate(`/estimates/${estimate.id}/materials`)}>
          Материалы
        </Button>
      </Tooltip>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Typography.Text strong style={{ fontSize: 15, whiteSpace: 'nowrap' }}>
          {title}
        </Typography.Text>
        <Typography.Text type="secondary" ellipsis style={{ fontSize: 12.5, maxWidth: 260 }}>
          {estimate.project_code} · {estimate.project_name}
        </Typography.Text>
      </div>

      <span style={{ color: '#1677ff', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {formatMoney(estimate.total_amount)}
      </span>
      <Typography.Text type="secondary" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
        Работ: {totalItems} · Видов работ: {groupCount}
      </Typography.Text>

      <span style={{ flex: 1 }} />

      <AiProcessingIndicator estimateId={estimate.id} />

      <Button type="dashed" icon={<PlusOutlined />} onClick={onAddCostType}>
        Вид работ
      </Button>
      <Tooltip title="История изменений">
        <Button type="text" icon={<HistoryOutlined />} onClick={onHistory} />
      </Tooltip>
      <Button type="text" icon={<EditOutlined />} onClick={onEdit} />

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
