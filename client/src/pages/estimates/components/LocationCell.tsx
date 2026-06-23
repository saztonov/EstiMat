import { useState } from 'react';
import { Tag, Popover, Button, Space } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import type { LocationAddContext } from '../../../store/locationContextStore';
import { LocationPicker } from './LocationPicker';
import { type ZoneNode, type RoomType, formatLocationLabel, hasLocation } from './location';
import type { EstimateItem } from './types';

interface Props {
  work: EstimateItem;
  editable: boolean;
  zones: ZoneNode[];
  roomTypes: RoomType[];
  onChange: (loc: LocationAddContext) => void;
}

// Ячейка локации работы: тег с подписью + поповер редактирования (география + тип помещения).
export function LocationCell({ work, editable, zones, roomTypes, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LocationAddContext>({
    zoneId: work.zone_id ?? null,
    floorFrom: work.floor_from ?? null,
    floorTo: work.floor_to ?? null,
    roomTypeId: work.room_type_id ?? null,
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
        roomTypeId: work.room_type_id ?? null,
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
          <LocationPicker size="small" zones={zones} roomTypes={roomTypes} value={draft} onChange={setDraft} />
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
