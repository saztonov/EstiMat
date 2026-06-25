import { Badge, Button, Checkbox, Divider, Popover, Space, Switch, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import {
  useLocationContextStore,
  useAddContext,
  useAddEnabled,
} from '../../../store/locationContextStore';
import { LocationPicker } from '../components/LocationPicker';
import type { ZoneNode } from '../components/location';

interface Props {
  estimateId: string;
  zones: ZoneNode[];
  /** Доступен ли контекст добавления (только при редактируемой смете). */
  editable: boolean;
  onlyUnreconciled: boolean;
  onUnreconciledChange: (v: boolean) => void;
}

// Колесико настроек: контекст добавления местоположения + фильтр «Не согласованные».
export function EstimateFilterSettingsPopover({
  estimateId,
  zones,
  editable,
  onlyUnreconciled,
  onUnreconciledChange,
}: Props) {
  const add = useAddContext(estimateId);
  const addEnabled = useAddEnabled(estimateId);
  const setAddContext = useLocationContextStore((s) => s.setAddContext);
  const setAddEnabled = useLocationContextStore((s) => s.setAddEnabled);

  const activeCount = (editable && addEnabled ? 1 : 0) + (onlyUnreconciled ? 1 : 0);

  const content = (
    <Space direction="vertical" size="middle" style={{ width: 360 }}>
      {editable && (
        <>
          <div>
            <Typography.Text type="secondary">Местоположение для добавления</Typography.Text>
            <div style={{ marginTop: 4 }}>
              <LocationPicker
                size="small"
                compact
                zones={zones}
                value={add}
                onChange={(v) => setAddContext(estimateId, v)}
              />
            </div>
          </div>
          <Checkbox
            checked={addEnabled}
            onChange={(e) => setAddEnabled(estimateId, e.target.checked)}
          >
            Добавлять в указанное местоположение
          </Checkbox>
          <Divider style={{ margin: 0 }} />
        </>
      )}
      <Space size={6}>
        <Switch size="small" checked={onlyUnreconciled} onChange={onUnreconciledChange} />
        <span style={{ fontSize: 13, color: '#595959' }}>Не согласованные</span>
      </Space>
    </Space>
  );

  return (
    <Popover trigger="click" placement="bottomRight" title="Настройки фильтров" content={content}>
      <Badge count={activeCount} size="small">
        <Button icon={<SettingOutlined />} />
      </Badge>
    </Popover>
  );
}
