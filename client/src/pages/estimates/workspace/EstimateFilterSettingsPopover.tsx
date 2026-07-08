import { useState } from 'react';
import { AutoComplete, Badge, Button, Checkbox, Flex, Popover, Space, Tooltip, Typography } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import {
  useLocationContextStore,
  useAddContext,
  useAddEnabled,
} from '../../../store/locationContextStore';
import { LocationPicker } from '../components/LocationPicker';
import { parseFloors, isValidFloorsInput, type ZoneNode } from '../components/location';
import type { AssignLocation } from './useSmetaSelection';

interface Props {
  estimateId: string;
  /** Объект сметы — для автодополнения произвольных «типов» строк. */
  projectId: string;
  zones: ZoneNode[];
  /** Доступен ли контекст добавления (только при редактируемой смете). */
  editable: boolean;
  /** Запустить режим массового копирования параметров (местоположение и/или тип) на выбранные работы.
   *  Передаётся только при наличии прав (admin/engineer) — иначе кнопка скрыта. */
  onAssignLocation?: (loc: AssignLocation) => void;
}

// Колесико: контекст добавления (местоположение и/или тип) + массовое копирование параметров
// на выбранные работы.
export function EstimateFilterSettingsPopover({
  estimateId,
  projectId,
  zones,
  editable,
  onAssignLocation,
}: Props) {
  const [open, setOpen] = useState(false);
  const add = useAddContext(estimateId);
  const addEnabled = useAddEnabled(estimateId);
  const setAddContext = useLocationContextStore((s) => s.setAddContext);
  const setAddEnabled = useLocationContextStore((s) => s.setAddEnabled);

  // Типы объекта для автодополнения (грузим при открытии поповера).
  const { data: typeData } = useQuery({
    queryKey: ['project-location-types', projectId],
    queryFn: () => api.get<{ data: { id: string; name: string }[] }>(`/projects/${projectId}/location-types`),
    enabled: open && !!projectId,
  });
  const typeOptions = (typeData?.data ?? []).map((t) => ({ value: t.name }));

  // Указанные параметры: местоположение (зона или этажи) и/или тип; этажи должны быть валидны.
  const floorsValid = isValidFloorsInput(add.floorsText);
  const hasLocation = !!add.zoneId || add.floorsText.trim().length > 0;
  const hasType = add.locationTypeName.trim().length > 0;

  // Бейдж на кнопке — количество заданных параметров контекста (местоположение + тип).
  const addLocCount = (hasLocation ? 1 : 0) + (hasType ? 1 : 0);

  const handleAssign = () => {
    onAssignLocation?.({
      zoneId: add.zoneId,
      floors: parseFloors(add.floorsText),
      locationTypeName: add.locationTypeName.trim() || null,
    });
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
          <Flex vertical gap={2}>
            <Typography.Text type="secondary">Тип</Typography.Text>
            <AutoComplete
              size="small"
              allowClear
              style={{ width: '100%' }}
              placeholder="Тип (например, Деф. шов)"
              value={add.locationTypeName}
              options={typeOptions}
              filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              onChange={(v) => setAddContext(estimateId, { ...add, locationTypeName: v ?? '' })}
            />
          </Flex>
          <Checkbox
            checked={addEnabled}
            onChange={(e) => setAddEnabled(estimateId, e.target.checked)}
          >
            Добавлять в указанное местоположение
          </Checkbox>
          {onAssignLocation && (
            <Tooltip title="Выбрать работы чекбоксами и скопировать на них указанные местоположение и/или тип">
              <Button
                block
                icon={<EnvironmentOutlined />}
                disabled={(!hasLocation && !hasType) || !floorsValid}
                onClick={handleAssign}
              >
                Копировать параметры на работы
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
