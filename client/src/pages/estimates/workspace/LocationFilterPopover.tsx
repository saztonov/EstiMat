import { Badge, Button, Popover, Select, Input, Segmented, Space, Switch, Typography, Divider } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { type ZoneNode, flattenZones, ZONE_KIND_LABEL, isValidFloorsInput } from '../components/location';

// Значение локационного отбора. Хранение — на стороне вызывающего: страница «Смета» держит его
// в глобальном store, раздел «Подрядчики» — в локальном состоянии вкладки (фильтры не должны
// протекать между разделами).
export interface LocationFilterValue {
  zoneIds: string[];
  floorsText: string;
  locationTypeIds: string[];
  volumeType: 'all' | 'main' | 'additional';
}

export const EMPTY_LOCATION_FILTER: LocationFilterValue = {
  zoneIds: [],
  floorsText: '',
  locationTypeIds: [],
  volumeType: 'all',
};

interface Props {
  zones: ZoneNode[];
  // Произвольные «типы» строк, присутствующие в смете (id → подпись).
  typeOptions: { value: string; label: string }[];
  value: LocationFilterValue;
  onChange: (patch: Partial<LocationFilterValue>) => void;
  onClear: () => void;
  /** Секция «Объём работ» (осн/доп). Скрытая — не участвует в счётчике и сбросе. */
  showVolumeType?: boolean;
  /** Фильтр «Не согласованные». Секция показывается, только если передан обработчик. */
  onlyUnreconciled?: boolean;
  onUnreconciledChange?: (v: boolean) => void;
  disabled?: boolean;
}

// Расширенный множественный фильтр локаций (срезы: «все корпуса 2,3 по этажам»),
// плюс отбор по типу строки, по типу объёма (осн/доп) и по согласованности.
export function LocationFilterPopover({
  zones,
  typeOptions,
  value,
  onChange,
  onClear,
  showVolumeType = true,
  onlyUnreconciled,
  onUnreconciledChange,
  disabled = false,
}: Props) {
  const showUnreconciled = !!onUnreconciledChange;

  const zoneOptions = flattenZones(zones).map((z) => ({
    value: z.id,
    label: z.kind === 'building' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
  }));

  const floorsValid = isValidFloorsInput(value.floorsText);
  const activeCount =
    value.zoneIds.length +
    (value.floorsText.trim() ? 1 : 0) +
    value.locationTypeIds.length +
    (showVolumeType && value.volumeType !== 'all' ? 1 : 0) +
    (showUnreconciled && onlyUnreconciled ? 1 : 0);

  const content = (
    <Space direction="vertical" size="middle" style={{ width: 320 }}>
      <div>
        <Typography.Text type="secondary">Корпуса / зоны</Typography.Text>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%', marginTop: 4 }}
          placeholder="Все"
          value={value.zoneIds}
          onChange={(v) => onChange({ zoneIds: v })}
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
          value={value.floorsText}
          status={floorsValid ? undefined : 'error'}
          onChange={(e) => onChange({ floorsText: e.target.value })}
        />
      </div>
      <div>
        <Typography.Text type="secondary">Тип</Typography.Text>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%', marginTop: 4 }}
          placeholder="Все"
          value={value.locationTypeIds}
          onChange={(v) => onChange({ locationTypeIds: v })}
          optionFilterProp="label"
          options={typeOptions}
        />
      </div>
      {showVolumeType && (
        <div>
          <Typography.Text type="secondary">Объём работ</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Segmented
              block
              value={value.volumeType}
              onChange={(v) => onChange({ volumeType: v as LocationFilterValue['volumeType'] })}
              options={[
                { label: 'Все', value: 'all' },
                { label: 'Осн', value: 'main' },
                { label: 'Доп', value: 'additional' },
              ]}
            />
          </div>
        </div>
      )}
      {showUnreconciled && (
        <Space size={6}>
          <Switch size="small" checked={onlyUnreconciled} onChange={onUnreconciledChange} />
          <span style={{ fontSize: 13, color: '#595959' }}>Не согласованные</span>
        </Space>
      )}
      <Divider style={{ margin: 0 }} />
      <Button
        size="small"
        disabled={activeCount === 0}
        onClick={() => {
          onClear();
          onUnreconciledChange?.(false);
        }}
      >
        Сбросить фильтр
      </Button>
    </Space>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Фильтр по местоположению"
      content={content}
      {...(disabled ? { open: false } : {})}
    >
      <Badge count={activeCount} size="small">
        <Button icon={<FilterOutlined />} disabled={disabled}>
          Местоположение
        </Button>
      </Badge>
    </Popover>
  );
}
