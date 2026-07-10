import { Badge, Button, Popover, Select, Input, Segmented, Space, Switch, Typography, Divider } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { useLocationContextStore } from '../../../store/locationContextStore';
import { type ZoneNode, flattenZones, ZONE_KIND_LABEL, isValidFloorsInput } from '../components/location';

interface Props {
  zones: ZoneNode[];
  // Произвольные «типы» строк, присутствующие в смете (id → подпись).
  typeOptions: { value: string; label: string }[];
  // Фильтр «Не согласованные» (состояние держит SmetaPanel).
  onlyUnreconciled: boolean;
  onUnreconciledChange: (v: boolean) => void;
}

// Расширенный множественный фильтр локаций (срезы: «все корпуса 2,3 по этажам»),
// плюс отбор по типу строки, по типу объёма (осн/доп) и по согласованности.
export function LocationFilterPopover({ zones, typeOptions, onlyUnreconciled, onUnreconciledChange }: Props) {
  const filterZoneIds = useLocationContextStore((s) => s.filterZoneIds);
  const filterFloorsText = useLocationContextStore((s) => s.filterFloorsText);
  const filterLocationTypeIds = useLocationContextStore((s) => s.filterLocationTypeIds);
  const filterVolumeType = useLocationContextStore((s) => s.filterVolumeType);
  const setFilter = useLocationContextStore((s) => s.setFilter);
  const clearFilter = useLocationContextStore((s) => s.clearFilter);

  const zoneOptions = flattenZones(zones).map((z) => ({
    value: z.id,
    label: z.kind === 'building' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
  }));

  const floorsValid = isValidFloorsInput(filterFloorsText);
  const activeCount =
    filterZoneIds.length +
    (filterFloorsText.trim() ? 1 : 0) +
    filterLocationTypeIds.length +
    (filterVolumeType !== 'all' ? 1 : 0) +
    (onlyUnreconciled ? 1 : 0);

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
        <Typography.Text type="secondary">Этажи (пересечение с диапазоном строки)</Typography.Text>
        <Input
          allowClear
          style={{ marginTop: 4 }}
          placeholder="2-4, 6, 11-18"
          value={filterFloorsText}
          status={floorsValid ? undefined : 'error'}
          onChange={(e) => setFilter({ filterFloorsText: e.target.value })}
        />
      </div>
      <div>
        <Typography.Text type="secondary">Тип</Typography.Text>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%', marginTop: 4 }}
          placeholder="Все"
          value={filterLocationTypeIds}
          onChange={(v) => setFilter({ filterLocationTypeIds: v })}
          optionFilterProp="label"
          options={typeOptions}
        />
      </div>
      <div>
        <Typography.Text type="secondary">Объём работ</Typography.Text>
        <div style={{ marginTop: 4 }}>
          <Segmented
            block
            value={filterVolumeType}
            onChange={(v) => setFilter({ filterVolumeType: v as 'all' | 'main' | 'additional' })}
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Осн', value: 'main' },
              { label: 'Доп', value: 'additional' },
            ]}
          />
        </div>
      </div>
      <Space size={6}>
        <Switch size="small" checked={onlyUnreconciled} onChange={onUnreconciledChange} />
        <span style={{ fontSize: 13, color: '#595959' }}>Не согласованные</span>
      </Space>
      <Divider style={{ margin: 0 }} />
      <Button
        size="small"
        disabled={activeCount === 0}
        onClick={() => {
          clearFilter();
          onUnreconciledChange(false);
        }}
      >
        Сбросить фильтр
      </Button>
    </Space>
  );

  return (
    <Popover trigger="click" placement="bottomRight" title="Фильтр по местоположению" content={content}>
      <Badge count={activeCount} size="small">
        <Button icon={<FilterOutlined />}>Местоположение</Button>
      </Badge>
    </Popover>
  );
}
