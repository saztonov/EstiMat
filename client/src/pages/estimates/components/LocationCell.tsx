import { useState } from 'react';
import { Tag, Popover, Button, Space } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import type { LocationAddContext } from '../../../store/locationContextStore';
import { LocationPicker } from './LocationPicker';
import { type ZoneNode, formatLocationLabel, hasLocation } from './location';
import type { EstimateItem } from './types';

interface Props {
  work: EstimateItem;
  editable: boolean;
  zones: ZoneNode[];
  onChange: (loc: LocationAddContext) => void;
}

// Ячейка локации работы: тег с подписью + поповер редактирования (география: зона + этажи).
export function LocationCell({ work, editable, zones, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LocationAddContext>({
    zoneId: work.zone_id ?? null,
    floorFrom: work.floor_from ?? null,
    floorTo: work.floor_to ?? null,
  });

  const label = formatLocationLabel(work);
  const tag = hasLocation(work) ? (
    <Tag color="geekblue" style={{ maxWidth: 150, cursor: editable ? 'pointer' : 'default', whiteSpace: 'normal' }}>
      {label}
    </Tag>
  ) : (
    <Tag style={{ cursor: editable ? 'pointer' : 'default', color: '#bfbfbf' }}>
      <EnvironmentOutlined /> —
    </Tag>
  );

  if (!editable) return tag;

  const onOpenChange = (v: boolean) => {
    if (v) {
      setDraft({
        zoneId: work.zone_id ?? null,
        floorFrom: work.floor_from ?? null,
        floorTo: work.floor_to ?? null,
      });
    }
    setOpen(v);
  };

  const apply = () => { onChange(draft); setOpen(false); };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger="click"
      placement="bottomLeft"
      title="Локация работы"
      content={
        <Space direction="vertical" style={{ width: 360 }}>
          <LocationPicker size="small" zones={zones} value={draft} onChange={setDraft} />
          <Space>
            <Button size="small" type="primary" onClick={apply}>Применить</Button>
            <Button size="small" onClick={() => setOpen(false)}>Отмена</Button>
          </Space>
        </Space>
      }
    >
      {tag}
    </Popover>
  );
}
