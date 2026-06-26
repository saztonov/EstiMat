import { useMemo } from 'react';
import { TreeSelect, Input, Flex, Typography } from 'antd';
import type { LocationAddContext } from '../../../store/locationContextStore';
import {
  type ZoneNode,
  ZONE_KIND_LABEL,
  isValidFloorsInput,
} from './location';

interface TreeData {
  value: string;
  title: string;
  children?: TreeData[];
}

function zonesToTreeData(nodes: ZoneNode[]): TreeData[] {
  return nodes.map((z) => ({
    value: z.id,
    title: z.kind === 'building' || z.kind === 'street' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
    children: z.children?.length ? zonesToTreeData(z.children) : undefined,
  }));
}

interface Props {
  zones: ZoneNode[];
  value: LocationAddContext;
  onChange: (v: LocationAddContext) => void;
  size?: 'small' | 'middle' | 'large';
}

// Выбор локации добавления: зона (дерево) + единое поле этажей. Точный набор «-1-10, 12, 16-18»
// (списки, диапазоны, минусы); пустое поле = весь корпус. Типы помещений временно скрыты.
export function LocationPicker({ zones, value, onChange, size = 'middle' }: Props) {
  const treeData = useMemo(() => zonesToTreeData(zones), [zones]);
  const floorsValid = isValidFloorsInput(value.floorsText);

  return (
    <Flex vertical gap={6} style={{ width: '100%' }}>
      <Flex gap={6} align="flex-start" style={{ width: '100%' }}>
        <TreeSelect
          size={size}
          allowClear
          showSearch
          treeDefaultExpandAll
          placeholder="Зона (корпус/парковка)"
          style={{ flex: 1, minWidth: 0 }}
          value={value.zoneId ?? undefined}
          treeData={treeData}
          treeNodeFilterProp="title"
          onChange={(v) => onChange({ ...value, zoneId: (v as string) ?? null })}
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
