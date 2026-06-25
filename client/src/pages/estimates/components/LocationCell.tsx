import { useState } from 'react';
import { Tag, Popover, Button, Space } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { MultiLocationPicker, type MultiLocationDraft } from './MultiLocationPicker';
import {
  type ZoneNode,
  type LocationEntry,
  formatLocationsLabel,
  hasLocation,
  parseFloors,
  formatFloors,
  isValidFloorsInput,
} from './location';
import type { EstimateItem } from './types';

interface Props {
  work: EstimateItem;
  editable: boolean;
  zones: ZoneNode[];
  onChange: (payload: { locations: LocationEntry[] }) => void;
}

// Черновик мультилокации из строки: зоны + объединённый набор этажей (одно поле на всю строку).
// Фолбэк на legacy-поля, если locations ещё не пришёл (до миграции/бэкфилла).
function toDraft(work: EstimateItem): MultiLocationDraft {
  const locs = work.locations ?? [];
  if (locs.length > 0) {
    const zoneIds = [...new Set(locs.map((l) => l.zoneId).filter((z): z is string => !!z))];
    const floors = locs.flatMap((l) => l.floors ?? []);
    return { zoneIds, floorsText: formatFloors(floors) };
  }
  const zoneIds = work.zone_id ? [work.zone_id] : [];
  const floors =
    work.floor_from != null && work.floor_to != null
      ? Array.from({ length: work.floor_to - work.floor_from + 1 }, (_, k) => work.floor_from! + k).filter((f) => f !== 0)
      : work.floor_from != null
        ? [work.floor_from]
        : work.floor_to != null
          ? [work.floor_to]
          : [];
  return { zoneIds, floorsText: formatFloors(floors) };
}

// Собрать массив локаций из черновика: набор этажей применяется ко всем выбранным зонам.
function draftToLocations(draft: MultiLocationDraft): LocationEntry[] {
  const floors = parseFloors(draft.floorsText);
  if (draft.zoneIds.length > 0) return draft.zoneIds.map((zoneId) => ({ zoneId, floors }));
  if (floors.length > 0) return [{ zoneId: null, floors }];
  return [];
}

// Ячейка локации работы: тег с подписью + поповер редактирования (мультизона + этажи).
export function LocationCell({ work, editable, zones, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MultiLocationDraft>(() => toDraft(work));

  const label = formatLocationsLabel(work.locations, zones);
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
    if (v) setDraft(toDraft(work));
    setOpen(v);
  };

  const apply = () => {
    onChange({ locations: draftToLocations(draft) });
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger="click"
      placement="bottomLeft"
      title="Местоположение работы"
      content={
        <Space direction="vertical" style={{ width: 400 }}>
          <MultiLocationPicker size="small" zones={zones} value={draft} onChange={setDraft} />
          <Space>
            <Button size="small" type="primary" disabled={!isValidFloorsInput(draft.floorsText)} onClick={apply}>
              Применить
            </Button>
            <Button size="small" onClick={() => setOpen(false)}>Отмена</Button>
          </Space>
        </Space>
      }
    >
      {tag}
    </Popover>
  );
}
