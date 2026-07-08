import { useState, type ReactNode } from 'react';
import { Badge, Button, Popover, Switch, Tooltip, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  TableOutlined,
  RobotOutlined,
  AppstoreOutlined,
  LayoutOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import type { EstimateDetail } from '../components/types';
import { formatMoney } from '../components/types';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { useIsMobile, useIsPhone } from '../../../hooks/useMediaQuery';
import { VersionHistoryDrawer } from './VersionHistoryDrawer';

interface Props {
  estimate: EstimateDetail;
  totalItems: number;
  groupCount: number;
  onBack: () => void;
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
}: Props) {
  const [versionsOpen, setVersionsOpen] = useState(false);
  const { visibility, toggleArea, setRefsDrawerOpen } = useWorkspaceLayoutStore();
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const title = estimate.work_type || 'Смета';
  // Сметная часть всегда включена (+1); ИИ и Справочники — по тумблерам.
  const activeCount = 1 + (visibility.ai ? 1 : 0) + (visibility.refs ? 1 : 0);

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: isPhone ? 8 : 12,
        // На телефоне шапка переносится на две строки (вторая — сумма и счётчики).
        flexWrap: isPhone ? 'wrap' : undefined,
        rowGap: isPhone ? 2 : undefined,
        // Левый отступ 48px — чтобы «К объекту» и прочее не перекрывались фикс-гамбургером
        // (position: fixed; top:8; left:8; ~32px) в верхней полосе.
        padding: '8px 12px 8px 48px',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      {isMobile ? (
        <Tooltip title="К объекту">
          <Button icon={<ArrowLeftOutlined />} aria-label="К объекту" onClick={onBack} />
        </Tooltip>
      ) : (
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          К объекту
        </Button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: isPhone ? 1 : undefined }}>
        <Typography.Text strong ellipsis={isPhone} style={{ fontSize: 15, whiteSpace: isPhone ? undefined : 'nowrap' }}>
          {title}
        </Typography.Text>
        {!isPhone && (
          <Typography.Text type="secondary" ellipsis style={{ fontSize: 12.5, maxWidth: isMobile ? 160 : 260 }}>
            {estimate.project_code} · {estimate.project_name}
          </Typography.Text>
        )}
      </div>

      {!isPhone && (
        <>
          <span style={{ color: '#1677ff', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {formatMoney(estimate.total_amount)}
          </span>
          <Typography.Text type="secondary" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
            Работ: {totalItems} · Видов работ: {groupCount}
          </Typography.Text>

          <span style={{ flex: 1 }} />
        </>
      )}

      <Tooltip title="История версий">
        <Button
          type="text"
          icon={<HistoryOutlined />}
          aria-label="История версий"
          onClick={() => setVersionsOpen(true)}
        />
      </Tooltip>
      <VersionHistoryDrawer open={versionsOpen} onClose={() => setVersionsOpen(false)} />

      {isMobile ? (
        // Мобильный режим: ИИ-панель недоступна, поповер «Панели» скрыт;
        // справочники открываются Drawer'ом поверх сметы.
        <Button icon={<AppstoreOutlined />} onClick={() => setRefsDrawerOpen(true)}>
          {isPhone ? null : 'Справочники'}
        </Button>
      ) : (
        <>
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
        </>
      )}

      {isPhone && (
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: '#1677ff', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {formatMoney(estimate.total_amount)}
          </span>
          <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            Работ: {totalItems} · Видов работ: {groupCount}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
