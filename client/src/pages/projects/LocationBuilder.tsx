import { useEffect, useRef, useState } from 'react';
import {
  Button, Input, InputNumber, Select, Popconfirm, Space, Tag, Typography, Divider,
  Alert, Spin, Empty, Tooltip, App,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, CopyOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useProjectZones, useRoomTypes, useProjectRoomTypes } from '../../hooks/useProjectLocations';
import {
  type ZoneNode, type ZoneKind, type BaseLayerPreset,
  ZONE_KIND_LABEL, ZONE_KIND_ICON, ZONE_KIND_COLOR, LAYER_BASE_ORDER, BASE_LAYER_PRESETS,
  flattenZones, formatFloorRange, floorCountToRange, rangeToFloorCount,
} from '../estimates/components/location';

interface Props {
  projectId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

// Черновая зона конструктора: id есть → UPDATE, нет → INSERT при сохранении.
interface DraftZone {
  key: string;
  id?: string;
  parentId: string | null;
  kind: ZoneKind;
  name: string;
  code: string | null;
  floorMin: number | null;
  floorMax: number | null;
  sortOrder: number;
}

const makeKey = () => (crypto?.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`);

function zoneToDraft(z: ZoneNode): DraftZone {
  return {
    key: z.id,
    id: z.id,
    parentId: z.parent_id,
    kind: z.kind,
    name: z.name,
    code: z.code,
    floorMin: z.floor_min,
    floorMax: z.floor_max,
    sortOrder: z.sort_order,
  };
}

// Слои с числовым счётчиком этажей (у техэтажа/кровли диапазона нет).
const HAS_FLOOR_COUNT: ZoneKind[] = ['parking', 'stylobate', 'building'];

// Визуальная высота блока яруса в разрезе по числу этажей.
function sliceHeight(z: DraftZone): number {
  const n = rangeToFloorCount(z.floorMin, z.floorMax);
  return n > 0 ? Math.min(168, Math.max(36, 24 + n * 5)) : 36;
}

function KindIcon({ kind }: { kind: ZoneKind }) {
  const Ico = ZONE_KIND_ICON[kind];
  return <Ico />;
}

export function LocationBuilder({ projectId, onDirtyChange }: Props) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'engineer' || role === 'manager';

  const { data: zonesData, isLoading, isError, refetch, isFetching } = useProjectZones(projectId);
  const { data: allRoomTypes } = useRoomTypes();
  const { data: activeRoomTypes } = useProjectRoomTypes(projectId);

  const [draft, setDraft] = useState<DraftZone[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [zonesDirty, setZonesDirty] = useState(false);
  const zonesDirtyRef = useRef(false);

  const markDirty = () => { zonesDirtyRef.current = true; setZonesDirty(true); };

  // (Пере)инициализация черновика из сервера — только когда нет несохранённых правок
  // (чтобы фоновый refetch не затёр редактирование).
  useEffect(() => {
    if (zonesDirtyRef.current) return;
    setDraft(flattenZones(zonesData?.data.roots ?? []).map(zoneToDraft));
  }, [zonesData]);

  // Типы помещений объекта (отдельная секция, отдельное сохранение).
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [typesDirty, setTypesDirty] = useState(false);
  useEffect(() => {
    if (activeRoomTypes?.data) {
      setSelectedTypes(activeRoomTypes.data.map((rt) => rt.id));
      setTypesDirty(false);
    }
  }, [activeRoomTypes]);

  useEffect(() => { onDirtyChange?.(zonesDirty || typesDirty); }, [zonesDirty, typesDirty, onDirtyChange]);

  const saveZones = useMutation({
    mutationFn: (payload: { zones: unknown[]; deletedIds: string[] }) =>
      api.put(`/projects/${projectId}/zones/bulk`, payload),
    onSuccess: () => {
      zonesDirtyRef.current = false;
      setZonesDirty(false);
      setDeletedIds([]);
      queryClient.invalidateQueries({ queryKey: ['project-zones', projectId] });
      // Этажность зон могла измениться — подписи локаций в строках сметы перестроятся.
      queryClient.invalidateQueries({ queryKey: ['project-estimate', projectId] });
      message.success('Местоположение сохранено');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const saveTypes = useMutation({
    mutationFn: (roomTypeIds: string[]) => api.put(`/projects/${projectId}/room-types`, { roomTypeIds }),
    onSuccess: () => {
      setTypesDirty(false);
      queryClient.invalidateQueries({ queryKey: ['project-room-types', projectId] });
      message.success('Типы помещений сохранены');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // ---------- мутации черновика ----------
  const patch = (key: string, p: Partial<DraftZone>) => {
    setDraft((prev) => prev.map((z) => (z.key === key ? { ...z, ...p } : z)));
    markDirty();
  };

  const setFloors = (z: DraftZone, count: number | null) => {
    const r = floorCountToRange(z.kind, count ?? 1);
    patch(z.key, { floorMin: r.floorMin, floorMax: r.floorMax });
  };

  const childCount = (z: DraftZone) => draft.filter((d) => z.id && d.parentId === z.id).length;

  const removeZone = (z: DraftZone) => {
    setDraft((prev) => prev.filter((x) => x.key !== z.key));
    if (z.id) setDeletedIds((prev) => (prev.includes(z.id!) ? prev : [...prev, z.id!]));
    markDirty();
  };

  const addLayer = (preset: BaseLayerPreset) => {
    if (!preset.repeatable && draft.some((d) => d.kind === preset.kind)) return;
    const sameKind = draft.filter((d) => d.kind === preset.kind).length;
    const name = preset.repeatable ? `${preset.defaultName} ${sameKind + 1}` : preset.defaultName;
    setDraft((prev) => [...prev, {
      key: makeKey(), parentId: null, kind: preset.kind, name,
      code: null, floorMin: preset.defaultFloorMin, floorMax: preset.defaultFloorMax, sortOrder: 0,
    }]);
    markDirty();
  };

  const duplicate = (z: DraftZone) => {
    setDraft((prev) => {
      const i = prev.findIndex((x) => x.key === z.key);
      const copy: DraftZone = { ...z, key: makeKey(), id: undefined, name: `${z.name} (копия)` };
      const arr = [...prev];
      arr.splice(i + 1, 0, copy);
      return arr;
    });
    markDirty();
  };

  // Перестановка внутри группы одного kind (корпуса/кровли).
  const move = (z: DraftZone, dir: 1 | -1) => {
    setDraft((prev) => {
      const arr = [...prev];
      const i = arr.findIndex((x) => x.key === z.key);
      if (i < 0) return prev;
      let j = i + dir;
      while (j >= 0 && j < arr.length && arr[j]!.kind !== z.kind) j += dir;
      if (j < 0 || j >= arr.length) return prev;
      const a = arr[i]!;
      const b = arr[j]!;
      arr[i] = b;
      arr[j] = a;
      return arr;
    });
    markDirty();
  };

  const quickTemplate = () => {
    setDraft([
      { key: makeKey(), parentId: null, kind: 'parking', name: 'Паркинг', code: null, floorMin: -2, floorMax: -1, sortOrder: 0 },
      { key: makeKey(), parentId: null, kind: 'stylobate', name: 'Стилобат', code: null, floorMin: 1, floorMax: 2, sortOrder: 0 },
      { key: makeKey(), parentId: null, kind: 'building', name: 'Корпус 1', code: null, floorMin: 1, floorMax: 10, sortOrder: 0 },
    ]);
    markDirty();
  };

  const onSaveZones = () => {
    if (draft.some((d) => !d.name.trim())) {
      message.error('У каждой локации должно быть название');
      return;
    }
    const buildings = draft.filter((d) => d.kind === 'building');
    const roofs = draft.filter((d) => d.kind === 'roof');
    const zones = draft.map((d) => {
      let sortOrder: number;
      if (d.kind === 'building') sortOrder = LAYER_BASE_ORDER.building + buildings.indexOf(d) * 10;
      else if (d.kind === 'roof') sortOrder = LAYER_BASE_ORDER.roof + roofs.indexOf(d) * 10;
      else if (d.kind === 'section' || d.kind === 'other') sortOrder = d.sortOrder;
      else sortOrder = LAYER_BASE_ORDER[d.kind];
      return {
        id: d.id, parentId: d.parentId, name: d.name.trim(), kind: d.kind,
        code: d.code || null, floorMin: d.floorMin, floorMax: d.floorMax, sortOrder,
      };
    });
    saveZones.mutate({ zones, deletedIds });
  };

  // ---------- группировка для рендера ----------
  const single = (k: ZoneKind) => draft.find((d) => d.kind === k);
  const buildings = draft.filter((d) => d.kind === 'building');
  const roofs = draft.filter((d) => d.kind === 'roof');
  const others = draft.filter((d) => d.kind === 'section' || d.kind === 'other');
  const parking = single('parking');
  const techfloor = single('techfloor');
  const stylobate = single('stylobate');

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  if (isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Не удалось загрузить локации объекта"
        action={<Button size="small" onClick={() => refetch()}>Повторить</Button>}
      />
    );
  }

  // ---------- разрез (левая панель) ----------
  const sliceBlock = (z: DraftZone) => (
    <div
      key={z.key}
      title={`${ZONE_KIND_LABEL[z.kind]} · ${z.name}`}
      style={{
        height: sliceHeight(z),
        background: `${ZONE_KIND_COLOR[z.kind]}1a`,
        border: `1px solid ${ZONE_KIND_COLOR[z.kind]}`,
        borderLeft: `4px solid ${ZONE_KIND_COLOR[z.kind]}`,
        borderRadius: 8,
        padding: '4px 8px',
        marginBottom: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        overflow: 'hidden',
      }}
    >
      <span style={{ color: ZONE_KIND_COLOR[z.kind], display: 'inline-flex' }}><KindIcon kind={z.kind} /></span>
      <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
        {z.name}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap' }}>{formatFloorRange(z.floorMin, z.floorMax)}</span>
    </div>
  );

  const groundLine = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
      <div style={{ flex: 1, borderTop: '2px dashed #bfbfbf' }} />
      <span style={{ fontSize: 10, color: '#bfbfbf', whiteSpace: 'nowrap' }}>уровень земли</span>
      <div style={{ flex: 1, borderTop: '2px dashed #bfbfbf' }} />
    </div>
  );

  const sliceView = (
    <div style={{ width: 240, flexShrink: 0 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Разрез</Typography.Text>
      <div style={{ marginTop: 8 }}>
        {draft.length === 0 ? (
          <div style={{ color: '#bfbfbf', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
            Пустая площадка
            {groundLine}
          </div>
        ) : (
          <>
            {roofs.map(sliceBlock)}
            {buildings.map(sliceBlock)}
            {stylobate && sliceBlock(stylobate)}
            {techfloor && sliceBlock(techfloor)}
            {groundLine}
            {parking && sliceBlock(parking)}
          </>
        )}
      </div>
    </div>
  );

  // ---------- редактор слоя (правая панель) ----------
  const layerRow = (z: DraftZone, opts?: { reorder?: boolean; duplicate?: boolean }) => {
    const kids = childCount(z);
    return (
      <div
        key={z.key}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 6,
        }}
      >
        <span style={{ color: ZONE_KIND_COLOR[z.kind], display: 'inline-flex', fontSize: 16 }}><KindIcon kind={z.kind} /></span>
        <Tag style={{ marginInlineEnd: 0 }}>{ZONE_KIND_LABEL[z.kind]}</Tag>
        <Input
          size="small"
          style={{ width: 180 }}
          value={z.name}
          disabled={!canEdit}
          placeholder="Название"
          onChange={(e) => patch(z.key, { name: e.target.value })}
        />
        <Input
          size="small"
          style={{ width: 90 }}
          value={z.code ?? ''}
          disabled={!canEdit}
          placeholder="Код"
          onChange={(e) => patch(z.key, { code: e.target.value })}
        />
        {HAS_FLOOR_COUNT.includes(z.kind) ? (
          <Space size={4}>
            <InputNumber
              size="small"
              style={{ width: 72 }}
              min={1}
              max={200}
              disabled={!canEdit}
              value={rangeToFloorCount(z.floorMin, z.floorMax) || 1}
              onChange={(v) => setFloors(z, v as number)}
            />
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>
              {z.kind === 'parking' ? 'подз.' : 'эт.'} · {formatFloorRange(z.floorMin, z.floorMax)}
            </span>
          </Space>
        ) : (
          <span style={{ fontSize: 12, color: '#bfbfbf', flex: 'none' }}>без этажности</span>
        )}
        <span style={{ flex: 1 }} />
        {opts?.reorder && canEdit && (
          <>
            <Button type="text" size="small" icon={<ArrowUpOutlined />} onClick={() => move(z, -1)} />
            <Button type="text" size="small" icon={<ArrowDownOutlined />} onClick={() => move(z, 1)} />
          </>
        )}
        {opts?.duplicate && canEdit && (
          <Tooltip title="Дублировать">
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => duplicate(z)} />
          </Tooltip>
        )}
        {canEdit && (kids > 0 ? (
          <Tooltip title="Сначала удалите вложенные локации">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled />
          </Tooltip>
        ) : (
          <Popconfirm
            title="Удалить локацию?"
            description="Строки сметы этой локации станут «без локации»."
            onConfirm={() => removeZone(z)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ))}
      </div>
    );
  };

  const palette = canEdit && (
    <Space wrap style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Добавить:</Typography.Text>
      {BASE_LAYER_PRESETS.map((p) => {
        const exists = !p.repeatable && draft.some((d) => d.kind === p.kind);
        return (
          <Button
            key={p.kind}
            size="small"
            icon={<PlusOutlined />}
            disabled={exists}
            onClick={() => addLayer(p)}
          >
            {p.label}
          </Button>
        );
      })}
    </Space>
  );

  const editorView = (
    <div style={{ flex: 1, minWidth: 0 }}>
      {palette}
      {draft.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Локации ещё не заданы">
          {canEdit && <Button type="primary" onClick={quickTemplate}>Быстрый шаблон: паркинг + стилобат + корпус</Button>}
        </Empty>
      ) : (
        <>
          {roofs.length > 0 && roofs.map((z) => layerRow(z, { reorder: roofs.length > 1 }))}
          {buildings.length > 0 && buildings.map((z) => layerRow(z, { reorder: buildings.length > 1, duplicate: true }))}
          {stylobate && layerRow(stylobate)}
          {techfloor && layerRow(techfloor)}
          {parking && layerRow(parking)}

          {others.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0 8px' }} orientation="left" plain>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Прочие локации</Typography.Text>
              </Divider>
              {others.map((z) => layerRow(z))}
            </>
          )}
        </>
      )}

      {canEdit && (
        <div style={{ marginTop: 12 }}>
          <Button
            type="primary"
            loading={saveZones.isPending}
            disabled={!zonesDirty}
            onClick={onSaveZones}
          >
            Сохранить
          </Button>
          {isFetching && <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>обновление…</Typography.Text>}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {sliceView}
        {editorView}
      </div>

      <Divider />
      <Typography.Title level={5}>Типы помещений объекта</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        Выберите типы, доступные при наборе сметы этого объекта. Если не выбрано — доступны все активные.
      </Typography.Paragraph>
      <Space.Compact style={{ width: '100%', maxWidth: 720 }}>
        <Select
          mode="multiple"
          allowClear
          disabled={!canEdit}
          style={{ flex: 1 }}
          placeholder="Типы помещений"
          value={selectedTypes}
          onChange={(v) => { setSelectedTypes(v); setTypesDirty(true); }}
          optionFilterProp="label"
          options={(allRoomTypes?.data ?? []).map((rt) => ({ value: rt.id, label: rt.name }))}
        />
        {canEdit && (
          <Button type="primary" loading={saveTypes.isPending} disabled={!typesDirty} onClick={() => saveTypes.mutate(selectedTypes)}>
            Сохранить
          </Button>
        )}
      </Space.Compact>
    </div>
  );
}
