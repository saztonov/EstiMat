import { useMemo } from 'react';
import { TreeSelect, Select, InputNumber, Button, Space, Tooltip } from 'antd';
import type { LocationAddContext } from '../../../store/locationContextStore';
import {
  type ZoneNode,
  type RoomType,
  ZONE_KIND_LABEL,
  findZone,
} from './location';

interface TreeData {
  value: string;
  title: string;
  children?: TreeData[];
}

function zonesToTreeData(nodes: ZoneNode[]): TreeData[] {
  return nodes.map((z) => ({
    value: z.id,
    title: z.kind === 'building' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
    children: z.children?.length ? zonesToTreeData(z.children) : undefined,
  }));
}

interface Props {
  zones: ZoneNode[];
  roomTypes: RoomType[];
  value: LocationAddContext;
  onChange: (v: LocationAddContext) => void;
  size?: 'small' | 'middle' | 'large';
  /** Компактный режим: контролы в один ряд без подписей. */
  compact?: boolean;
}

// Выбор локации строки: зона (дерево) + диапазон этажей + тип помещения.
export function LocationPicker({ zones, roomTypes, value, onChange, size = 'middle', compact }: Props) {
  const treeData = useMemo(() => zonesToTreeData(zones), [zones]);
  const zone = useMemo(() => findZone(zones, value.zoneId), [zones, value.zoneId]);
  const hasFloors = !!zone && zone.floor_min != null && zone.floor_max != null;

  const setZone = (zoneId: string | null) => {
    const z = findZone(zones, zoneId);
    // Сбросить этажи под диапазон новой зоны (или очистить, если зона без этажности).
    const floorFrom = z && z.floor_min != null ? z.floor_min : null;
    const floorTo = z && z.floor_max != null ? z.floor_max : null;
    onChange({ ...value, zoneId, floorFrom, floorTo });
  };

  const clampFloor = (v: number | null): number | null => {
    if (v == null || !zone || zone.floor_min == null || zone.floor_max == null) return v;
    return Math.min(Math.max(v, zone.floor_min), zone.floor_max);
  };

  return (
    <Space wrap={!compact} size={compact ? 4 : 8} style={{ width: '100%' }}>
      <TreeSelect
        size={size}
        allowClear
        showSearch
        treeDefaultExpandAll
        placeholder="Зона (корпус/парковка)"
        style={{ minWidth: 180 }}
        value={value.zoneId ?? undefined}
        treeData={treeData}
        treeNodeFilterProp="title"
        onChange={(v) => setZone((v as string) ?? null)}
      />
      <Space.Compact>
        <InputNumber
          size={size}
          placeholder="этаж от"
          style={{ width: 92 }}
          disabled={!hasFloors}
          min={zone?.floor_min ?? undefined}
          max={zone?.floor_max ?? undefined}
          value={value.floorFrom ?? undefined}
          onChange={(v) => onChange({ ...value, floorFrom: clampFloor(v as number | null) })}
        />
        <InputNumber
          size={size}
          placeholder="до"
          style={{ width: 80 }}
          disabled={!hasFloors}
          min={zone?.floor_min ?? undefined}
          max={zone?.floor_max ?? undefined}
          value={value.floorTo ?? undefined}
          onChange={(v) => onChange({ ...value, floorTo: clampFloor(v as number | null) })}
        />
        {hasFloors && (
          <Tooltip title="Весь корпус (все этажи)">
            <Button
              size={size}
              onClick={() => onChange({ ...value, floorFrom: zone!.floor_min, floorTo: zone!.floor_max })}
            >
              всё
            </Button>
          </Tooltip>
        )}
      </Space.Compact>
      <Select
        size={size}
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="Тип помещения"
        style={{ minWidth: 160 }}
        value={value.roomTypeId ?? undefined}
        onChange={(v) => onChange({ ...value, roomTypeId: (v as string) ?? null })}
        options={roomTypes.map((rt) => ({ value: rt.id, label: rt.name }))}
      />
    </Space>
  );
}
