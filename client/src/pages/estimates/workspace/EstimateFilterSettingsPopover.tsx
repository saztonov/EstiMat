import { useState } from 'react';
import { Badge, Button, Checkbox, Divider, Popover, Space, Tooltip, Typography } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import {
  useLocationContextStore,
  useAddContext,
  useAddEnabled,
} from '../../../store/locationContextStore';
import { LocationPicker } from '../components/LocationPicker';
import { parseFloors, isValidFloorsInput, type ZoneNode } from '../components/location';

interface Props {
  estimateId: string;
  zones: ZoneNode[];
  /** Доступен ли контекст добавления (только при редактируемой смете). */
  editable: boolean;
  /** Запустить режим массового назначения выбранного местоположения работам.
   *  Передаётся только при наличии прав (admin/engineer) — иначе кнопка скрыта. */
  onAssignLocation?: (loc: { zoneId: string | null; floors: number[] }) => void;
}

// Колесико: контекст добавления местоположения + массовое назначение выбранным работам.
export function EstimateFilterSettingsPopover({
  estimateId,
  zones,
  editable,
  onAssignLocation,
}: Props) {
  const [open, setOpen] = useState(false);
  const add = useAddContext(estimateId);
  const addEnabled = useAddEnabled(estimateId);
  const setAddContext = useLocationContextStore((s) => s.setAddContext);
  const setAddEnabled = useLocationContextStore((s) => s.setAddEnabled);

  // Бейдж на кнопке — количество указанных местоположений (зона), без учёта этажей.
  const addLocCount = add.zoneId ? 1 : 0;

  // Местоположение выбрано (зона или этажи) и поле этажей валидно — можно назначать.
  const floorsValid = isValidFloorsInput(add.floorsText);
  const hasLocation = !!add.zoneId || add.floorsText.trim().length > 0;

  const handleAssign = () => {
    onAssignLocation?.({ zoneId: add.zoneId, floors: parseFloors(add.floorsText) });
    setOpen(false);
  };

  const content = (
    <Space direction="vertical" size="middle" style={{ width: 360, maxWidth: 'calc(100vw - 32px)' }}>
      {editable && (
        <>
          <div>
            <Typography.Text type="secondary">Местоположение для добавления</Typography.Text>
            <div style={{ marginTop: 4 }}>
              <LocationPicker
                size="small"
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
          {onAssignLocation && (
            <Tooltip title="Выбрать работы чекбоксами и назначить им это местоположение">
              <Button
                block
                icon={<EnvironmentOutlined />}
                disabled={!hasLocation || !floorsValid}
                onClick={handleAssign}
              >
                Назначить выбранное местоположение
              </Button>
            </Tooltip>
          )}
        </>
      )}
    </Space>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Назначение местоположения для добавляемых работ"
      content={content}
      open={open}
      onOpenChange={setOpen}
    >
      <Badge count={addLocCount} size="small">
        <Button icon={<EnvironmentOutlined />} title="Назначение местоположения" />
      </Badge>
    </Popover>
  );
}
