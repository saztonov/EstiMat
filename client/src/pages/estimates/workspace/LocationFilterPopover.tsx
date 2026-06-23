import { Badge, Button, Popover, Select, InputNumber, Space, Typography, Divider } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { useLocationContextStore } from '../../../store/locationContextStore';
import { type ZoneNode, type RoomType, flattenZones, ZONE_KIND_LABEL } from '../components/location';

interface Props {
  zones: ZoneNode[];
  roomTypes: RoomType[];
}

// Расширенный множественный фильтр локаций (срезы: «все ЛК по корпусам 2,3»).
export function LocationFilterPopover({ zones, roomTypes }: Props) {
  const filterZoneIds = useLocationContextStore((s) => s.filterZoneIds);
  const filterRoomTypeIds = useLocationContextStore((s) => s.filterRoomTypeIds);
  const filterFloorFrom = useLocationContextStore((s) => s.filterFloorFrom);
  const filterFloorTo = useLocationContextStore((s) => s.filterFloorTo);
  const setFilter = useLocationContextStore((s) => s.setFilter);
  const clearFilter = useLocationContextStore((s) => s.clearFilter);

  const zoneOptions = flattenZones(zones).map((z) => ({
    value: z.id,
    label: z.kind === 'building' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
  }));

  const activeCount =
    filterZoneIds.length + filterRoomTypeIds.length + (filterFloorFrom != null || filterFloorTo != null ? 1 : 0);

  const content = (
    <Space direction="vertical" size="middle" style={{ width: 320 }}>
      <div>
        <Typography.Text type="secondary">Корпуса / зоны</Typography.Text>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%', marginTop: 4 }}
          placeholder="Все"
          value={filterZoneIds}
          onChange={(v) => setFilter({ filterZoneIds: v })}
          optionFilterProp="label"
          options={zoneOptions}
        />
      </div>
      <div>
        <Typography.Text type="secondary">Типы помещений</Typography.Text>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%', marginTop: 4 }}
          placeholder="Все"
          value={filterRoomTypeIds}
          onChange={(v) => setFilter({ filterRoomTypeIds: v })}
          optionFilterProp="label"
          options={roomTypes.map((rt) => ({ value: rt.id, label: rt.name }))}
        />
      </div>
      <div>
        <Typography.Text type="secondary">Этажи (пересечение с диапазоном строки)</Typography.Text>
        <Space style={{ marginTop: 4 }}>
          <InputNumber
            placeholder="от"
            style={{ width: 90 }}
            value={filterFloorFrom ?? undefined}
            onChange={(v) => setFilter({ filterFloorFrom: v as number | null })}
            step={1}
          />
          <InputNumber
            placeholder="до"
            style={{ width: 90 }}
            value={filterFloorTo ?? undefined}
            onChange={(v) => setFilter({ filterFloorTo: v as number | null })}
            step={1}
          />
        </Space>
      </div>
      <Divider style={{ margin: 0 }} />
      <Button size="small" disabled={activeCount === 0} onClick={clearFilter}>
        Сбросить фильтр
      </Button>
    </Space>
  );

  return (
    <Popover trigger="click" placement="bottomRight" title="Фильтр по локации" content={content}>
      <Badge count={activeCount} size="small">
        <Button icon={<FilterOutlined />}>Фильтр локации</Button>
      </Badge>
    </Popover>
  );
}
