import { useMemo, useState } from 'react';
import { Popover, Button, Space, AutoComplete, Typography, Flex } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { MultiLocationPicker, type MultiLocationDraft } from './MultiLocationPicker';
import {
  type ZoneNode,
  type LocationEntry,
  formatFloors,
  parseFloors,
  isValidFloorsInput,
  countLocationCells,
  distributePerCell,
} from './location';
import { LocationBadges, buildZoneIndex, locationParts, toLocationSnapshot } from './LocationBadges';
import type { EstimateItem } from './types';

interface Props {
  work: EstimateItem;
  editable: boolean;
  zones: ZoneNode[];
  /** Объект строки — для автодополнения произвольных «типов» в поповере. */
  projectId: string;
  onChange: (payload: { locations: LocationEntry[]; locationTypeName?: string | null }) => void;
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

// Объём как число: до 3 знаков, без хвостовых нулей.
function fmtQty(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

// Русская форма для счётного слова (1 ячейка, 2 ячейки, 5 ячеек).
function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// Редактор локации: монтируется ТОЛЬКО когда поповер открыт. Здесь живут и запрос типов объекта,
// и тяжёлая разметка (MultiLocationPicker + автодополнение + сводка распределения) — раньше всё
// это объявлялось прямо в ячейке и строилось на каждый рендер дерева у КАЖДОЙ из сотен строк,
// хотя редактируется всегда одна.
function LocationEditor({
  work,
  zones,
  projectId,
  onChange,
  onClose,
}: Omit<Props, 'editable'> & { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MultiLocationDraft>(() => toDraft(work));
  const [typeName, setTypeName] = useState<string>(work.location_type_name ?? '');

  // Типы объекта для автодополнения.
  const { data: typeData } = useQuery({
    queryKey: ['project-location-types', projectId],
    queryFn: () => api.get<{ data: { id: string; name: string }[] }>(`/projects/${projectId}/location-types`),
    enabled: !!projectId,
  });
  const typeOptions = (typeData?.data ?? []).map((t) => ({ value: t.name }));

  const apply = () => {
    // Тип шлём только если он реально изменился относительно read-модели: иначе пустой
    // (не пришедший с сервера) тип затёр бы сохранённый location_type_id значением null.
    const nextType = typeName.trim() || null;
    const currentType = work.location_type_name ?? null;
    onChange({
      locations: draftToLocations(draft),
      ...(nextType !== currentType ? { locationTypeName: nextType } : {}),
    });
    // Новый тип появится в подсказках — обновим кэш списка типов объекта.
    queryClient.invalidateQueries({ queryKey: ['project-location-types', projectId] });
    onClose();
  };

  // Live-сводка равномерного распределения объёма по ячейкам «зона×этаж».
  const previewLocations = draftToLocations(draft);
  const qty = Number(work.quantity);
  const cells = countLocationCells(previewLocations, zones);
  const perCell = distributePerCell(previewLocations, qty, zones);

  return (
    <Space direction="vertical" style={{ width: 400 }}>
      <MultiLocationPicker size="small" zones={zones} value={draft} onChange={setDraft} />
      <Flex vertical gap={2}>
        <Typography.Text strong style={{ fontSize: 12 }}>
          Типы
        </Typography.Text>
        <AutoComplete
          size="small"
          allowClear
          style={{ width: '100%' }}
          placeholder="Тип (например, Тип 1)"
          value={typeName}
          options={typeOptions}
          filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
          onChange={(v) => setTypeName(v ?? '')}
        />
      </Flex>
      {cells > 0 && qty > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Объём {fmtQty(qty)} {work.unit} ÷ {cells} {plural(cells, ['ячейка', 'ячейки', 'ячеек'])} = по{' '}
          {fmtQty(perCell)} {work.unit}
        </Typography.Text>
      )}
      <Space>
        <Button size="small" type="primary" disabled={!isValidFloorsInput(draft.floorsText)} onClick={apply}>
          Применить
        </Button>
        <Button size="small" onClick={onClose}>
          Отмена
        </Button>
      </Space>
    </Space>
  );
}

// Ячейка локации работы: раздельные бейджи (зоны / этажи / тип) + поповер редактирования.
export function LocationCell({ work, editable, zones, projectId, onChange }: Props) {
  const [open, setOpen] = useState(false);

  // Раздельные бейджи: каждая зона своим тегом + тег этажей + тег типа.
  const zoneIndex = useMemo(() => buildZoneIndex(zones), [zones]);
  const { zoneNames, floorsLabel, typeLabel } = locationParts(toLocationSnapshot(work), zoneIndex);

  const badges = (
    <LocationBadges zoneNames={zoneNames} floorsLabel={floorsLabel} typeLabels={typeLabel ? [typeLabel] : []} />
  );

  const trigger = (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        gap: 4,
        alignItems: 'center',
        maxWidth: '100%',
        cursor: editable ? 'pointer' : 'default',
      }}
    >
      {badges}
    </span>
  );

  if (!editable) return trigger;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      title="Местоположение работы"
      // Редактор монтируется при открытии, поэтому черновик инициализируется актуальной строкой
      // в своём начальном состоянии — отдельный сброс на onOpenChange больше не нужен.
      content={
        open ? (
          <LocationEditor
            work={work}
            zones={zones}
            projectId={projectId}
            onChange={onChange}
            onClose={() => setOpen(false)}
          />
        ) : null
      }
    >
      {trigger}
    </Popover>
  );
}
