import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Modal, Popover, Switch, Tooltip, Typography, App } from 'antd';
import {
  ArrowLeftOutlined,
  TableOutlined,
  RobotOutlined,
  AppstoreOutlined,
  LayoutOutlined,
  HistoryOutlined,
  ContainerOutlined,
} from '@ant-design/icons';
import type { EstimateDetail } from '../components/types';
import { formatMoney } from '../components/types';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { LocationBuilder } from '../../projects/LocationBuilder';
import { BuildingsIcon } from '../../../components/shared/BuildingsIcon';

interface Props {
  estimate: EstimateDetail;
  totalItems: number;
  groupCount: number;
  onBack: () => void;
  onHistory: () => void;
}

// Строка-переключатель области внутри поповера «Панели»
function PanelSwitchRow({
  icon,
  label,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span style={{ color: '#8c8c8c', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
      <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function WorkspaceToolbar({
  estimate,
  totalItems,
  groupCount,
  onBack,
  onHistory,
}: Props) {
  const { visibility, toggleArea } = useWorkspaceLayoutStore();
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const [zonesOpen, setZonesOpen] = useState(false);
  const [zonesDirty, setZonesDirty] = useState(false);
  const title = estimate.work_type || 'Смета';
  // Сметная часть всегда включена (+1); ИИ и Справочники — по тумблерам.
  const activeCount = 1 + (visibility.ai ? 1 : 0) + (visibility.refs ? 1 : 0);

  const closeZones = () => {
    if (zonesDirty) {
      modal.confirm({
        title: 'Закрыть без сохранения?',
        content: 'Есть несохранённые изменения местоположения.',
        okText: 'Закрыть',
        cancelText: 'Остаться',
        onOk: () => { setZonesDirty(false); setZonesOpen(false); },
      });
    } else {
      setZonesOpen(false);
    }
  };

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        // Левый отступ 48px — чтобы «К объекту» и прочее не перекрывались фикс-гамбургером
        // (position: fixed; top:8; left:8; ~32px) в верхней полосе.
        padding: '8px 12px 8px 48px',
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
      <Tooltip title="Местоположение: корпуса, этажность, типы помещений">
        <Button icon={<BuildingsIcon />} onClick={() => { setZonesDirty(false); setZonesOpen(true); }}>
          Местоположение
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

      <Tooltip title="История изменений">
        <Button type="text" icon={<HistoryOutlined />} onClick={onHistory} />
      </Tooltip>

      <span style={{ width: 1, height: 22, background: '#f0f0f0', margin: '0 2px' }} />

      <Popover
        trigger="click"
        placement="bottomRight"
        content={
          <div style={{ minWidth: 200 }}>
            <Tooltip title="Сметная часть всегда включена" placement="left">
              <div>
                <PanelSwitchRow icon={<TableOutlined />} label="Сметная часть" checked disabled />
              </div>
            </Tooltip>
            <PanelSwitchRow
              icon={<RobotOutlined />}
              label="ИИ часть"
              checked={visibility.ai}
              onChange={() => toggleArea('ai')}
            />
            <PanelSwitchRow
              icon={<AppstoreOutlined />}
              label="Справочники"
              checked={visibility.refs}
              onChange={() => toggleArea('refs')}
            />
          </div>
        }
      >
        <Badge count={activeCount} size="small" color="#1677ff" offset={[-2, 2]}>
          <Button icon={<LayoutOutlined />}>Панели</Button>
        </Badge>
      </Popover>

      <Modal
        title="Местоположение"
        open={zonesOpen}
        onCancel={closeZones}
        footer={null}
        width="90%"
        style={{ top: 24 }}
        styles={{ body: { height: 'calc(100vh - 180px)', overflow: 'hidden' } }}
      >
        {zonesOpen && (
          <LocationBuilder projectId={estimate.project_id} onDirtyChange={setZonesDirty} />
        )}
      </Modal>
    </div>
  );
}
