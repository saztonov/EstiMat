import { useMemo } from 'react';
import { Select, Input, Flex, Typography } from 'antd';
import { type ZoneNode, flattenZones, ZONE_KIND_LABEL, isValidFloorsInput } from './location';

// Черновик мультилокации в поповере: несколько зон + единое текстовое поле этажей.
export interface MultiLocationDraft {
  zoneIds: string[];
  floorsText: string;
}

interface Props {
  zones: ZoneNode[];
  value: MultiLocationDraft;
  onChange: (v: MultiLocationDraft) => void;
  size?: 'small' | 'middle' | 'large';
}

// Выбор локации строки: множественный выбор зон + единое поле этажей (точный набор
// «1-4, 6», поддержка минусов «-1-8»). Один набор этажей применяется ко всем зонам.
export function MultiLocationPicker({ zones, value, onChange, size = 'small' }: Props) {
  const zoneOptions = useMemo(
    () =>
      flattenZones(zones).map((z) => ({
        value: z.id,
        label: z.kind === 'building' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
      })),
    [zones],
  );

  const floorsValid = isValidFloorsInput(value.floorsText);

  return (
    <Flex vertical gap={6} style={{ width: '100%' }}>
      <Flex gap={6} align="flex-start" style={{ width: '100%' }}>
        <Select
          mode="multiple"
          size={size}
          allowClear
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Зоны (можно несколько)"
          value={value.zoneIds}
          onChange={(v) => onChange({ ...value, zoneIds: v })}
          optionFilterProp="label"
          options={zoneOptions}
        />
        <Input
          size={size}
          style={{ width: 130, flexShrink: 0 }}
          placeholder="Этажи: 1-4, 6"
          value={value.floorsText}
          status={floorsValid ? undefined : 'error'}
          onChange={(e) => onChange({ ...value, floorsText: e.target.value })}
        />
      </Flex>
      {!floorsValid && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          Формат: числа и диапазоны через запятую, например «1-4, 6» или «-1-8».
        </Typography.Text>
      )}
    </Flex>
  );
}
