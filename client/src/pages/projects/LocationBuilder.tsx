import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Input, InputNumber, Select, Popconfirm, Space, Tag, Typography, Divider,
  Alert, Spin, Empty, Tooltip, App,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, CopyOutlined, ArrowLeftOutlined, ArrowRightOutlined,
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

// Черновая зона конструктора. id есть всегда (для новых — сгенерированный uuid),
// чтобы ссылки parentId/spansZoneIds были стабильны до сохранения (сервер делает upsert по id).
interface DraftZone {
  id: string;
  parentId: string | null;     // стилобат/секция «в составе корпуса» → id корпуса
  kind: ZoneKind;
  name: string;
  code: string | null;
  floorMin: number | null;
  floorMax: number | null;
  spansZoneIds: string[];       // корпуса, под/над/между которыми элемент (для несвязанных слоёв)
}

const makeId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`);

function zoneToDraft(z: ZoneNode): DraftZone {
  return {
    id: z.id,
    parentId: z.parent_id,
    kind: z.kind,
    name: z.name,
    code: z.code,
    floorMin: z.floor_min,
    floorMax: z.floor_max,
    spansZoneIds: z.spans_zone_ids ?? [],
  };
}

// Геометрия разреза
const COLW = 120;   // ширина колонки корпуса
const GAP = 28;     // промежуток между корпусами
const RH = 15;      // высота одного этажа
const TOPPAD = 14;  // место под полоску кровли
const AXISW = 30;   // ось этажей слева

const buildingCount = (b: DraftZone) => (b.floorMax ?? 1) - (b.floorMin ?? 1) + 1;

export function LocationBuilder({ projectId, onDirtyChange }: Props) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'engineer' || role === 'manager';

  const { data: zonesData, isLoading, isError, refetch, isFetching } = useProjectZones(projectId);
  const { data: allRoomTypes } = useRoomTypes();
  const { data: activeRoomTypes } = useProjectRoomTypes(projectId);

  const [draft, setDraft] = useState<DraftZone[]>([]);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const deletedIdsRef = useRef<string[]>([]);
  const serverIdsRef = useRef<Set<string>>(new Set());

  const markDirty = () => { dirtyRef.current = true; setDirty(true); };
  const pushDeleted = (id: string) => {
    if (serverIdsRef.current.has(id) && !deletedIdsRef.current.includes(id)) deletedIdsRef.current.push(id);
  };

  // (Пере)инициализация из сервера — только без несохранённых правок (фоновый refetch не затирает).
  useEffect(() => {
    if (dirtyRef.current) return;
    const flat = flattenZones(zonesData?.data.roots ?? []);
    serverIdsRef.current = new Set(flat.map((z) => z.id));
    deletedIdsRef.current = [];
    setDraft(flat.map(zoneToDraft));
  }, [zonesData]);

  // Типы помещений — отдельная секция, отдельное сохранение.
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [typesDirty, setTypesDirty] = useState(false);
  useEffect(() => {
    if (activeRoomTypes?.data) {
      setSelectedTypes(activeRoomTypes.data.map((rt) => rt.id));
      setTypesDirty(false);
    }
  }, [activeRoomTypes]);

  useEffect(() => { onDirtyChange?.(dirty || typesDirty); }, [dirty, typesDirty, onDirtyChange]);

  const saveZones = useMutation({
    mutationFn: (payload: { zones: unknown[]; deletedIds: string[] }) =>
      api.put(`/projects/${projectId}/zones/bulk`, payload),
    onSuccess: () => {
      dirtyRef.current = false;
      setDirty(false);
      deletedIdsRef.current = [];
      queryClient.invalidateQueries({ queryKey: ['project-zones', projectId] });
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

  // ---------- базовые мутации черновика ----------
  const patch = (id: string, p: Partial<DraftZone>) => {
    setDraft((prev) => prev.map((z) => (z.id === id ? { ...z, ...p } : z)));
    markDirty();
  };

  const removeZone = (z: DraftZone) => {
    setDraft((prev) => {
      const toRemove = new Set<string>([z.id]);
      // удаляем и вложенные (стилобат-в-составе, секции) — их zone_id в смете обнулится по FK
      prev.forEach((c) => { if (c.parentId === z.id) toRemove.add(c.id); });
      toRemove.forEach(pushDeleted);
      return prev.filter((x) => !toRemove.has(x.id));
    });
    markDirty();
  };

  const addLayer = (preset: BaseLayerPreset) => {
    const sameKind = draft.filter((d) => d.kind === preset.kind && d.parentId == null).length;
    setDraft((prev) => [...prev, {
      id: makeId(), parentId: null, kind: preset.kind,
      name: `${preset.defaultName}${sameKind > 0 ? ` ${sameKind + 1}` : ''}`,
      code: null, floorMin: preset.defaultFloorMin, floorMax: preset.defaultFloorMax, spansZoneIds: [],
    }]);
    markDirty();
  };

  const duplicate = (z: DraftZone) => {
    setDraft((prev) => {
      const i = prev.findIndex((x) => x.id === z.id);
      const copy: DraftZone = { ...z, id: makeId(), name: `${z.name} (копия)`, spansZoneIds: [...z.spansZoneIds] };
      const arr = [...prev];
      arr.splice(i + 1, 0, copy);
      return arr;
    });
    markDirty();
  };

  // Перестановка корпуса влево/вправо (внутри группы building, parentId=null).
  const moveBuilding = (z: DraftZone, dir: 1 | -1) => {
    setDraft((prev) => {
      const arr = [...prev];
      const i = arr.findIndex((x) => x.id === z.id);
      if (i < 0) return prev;
      let j = i + dir;
      while (j >= 0 && j < arr.length && !(arr[j]!.kind === 'building' && arr[j]!.parentId == null)) j += dir;
      if (j < 0 || j >= arr.length) return prev;
      const a = arr[i]!; const b = arr[j]!;
      arr[i] = b; arr[j] = a;
      return arr;
    });
    markDirty();
  };

  // Корпус: число надземных этажей и высота стилобата «в составе» (сквозная нумерация).
  const applyBuilding = (buildingId: string, opts: { count?: number; stylobate?: number }) => {
    setDraft((prev) => {
      const b = prev.find((z) => z.id === buildingId);
      if (!b) return prev;
      let next = [...prev];
      const child = next.find((z) => z.kind === 'stylobate' && z.parentId === buildingId);
      let s = child ? (child.floorMax ?? 0) : 0;

      if (opts.stylobate !== undefined) {
        const sNew = Math.max(0, Math.round(opts.stylobate));
        if (sNew > 0) {
          s = sNew;
          if (child) {
            next = next.map((z) => (z.id === child.id ? { ...z, floorMin: 1, floorMax: sNew, spansZoneIds: [buildingId] } : z));
          } else {
            next = [...next, {
              id: makeId(), parentId: buildingId, kind: 'stylobate',
              name: `Стилобат (${b.name})`, code: null, floorMin: 1, floorMax: sNew, spansZoneIds: [buildingId],
            }];
          }
        } else {
          if (child) { pushDeleted(child.id); next = next.filter((z) => z.id !== child.id); }
          s = 0;
        }
      }

      const count = opts.count ?? buildingCount(b);
      const newMin = s + 1;
      const newMax = newMin + Math.max(1, count) - 1;
      next = next.map((z) => (z.id === buildingId ? { ...z, floorMin: newMin, floorMax: newMax } : z));
      return next;
    });
    markDirty();
  };

  const quickTemplate = () => {
    const bId = makeId();
    setDraft([
      { id: bId, parentId: null, kind: 'building', name: 'Корпус 1', code: null, floorMin: 1, floorMax: 10, spansZoneIds: [] },
      { id: makeId(), parentId: null, kind: 'parking', name: 'Паркинг', code: null, floorMin: -2, floorMax: -1, spansZoneIds: [bId] },
      { id: makeId(), parentId: null, kind: 'stylobate', name: 'Стилобат', code: null, floorMin: 1, floorMax: 2, spansZoneIds: [bId] },
    ]);
    markDirty();
  };

  const onSaveZones = () => {
    if (draft.some((d) => !d.name.trim())) { message.error('У каждой локации должно быть название'); return; }
    const bad = draft.find((d) => d.floorMin != null && d.floorMax != null && d.floorMin > d.floorMax);
    if (bad) { message.error(`«${bad.name}»: нижний этаж больше верхнего`); return; }

    const buildingsList = draft.filter((d) => d.kind === 'building' && d.parentId == null);
    const buildingIdSet = new Set(buildingsList.map((b) => b.id));
    const zones = draft.map((d) => {
      let sortOrder: number;
      if (d.kind === 'building' && d.parentId == null) sortOrder = LAYER_BASE_ORDER.building + buildingsList.indexOf(d) * 10;
      else if (d.kind === 'roof') sortOrder = LAYER_BASE_ORDER.roof;
      else if (d.kind === 'section' || d.kind === 'other') sortOrder = LAYER_BASE_ORDER[d.kind];
      else sortOrder = LAYER_BASE_ORDER[d.kind] ?? 0;
      return {
        id: d.id, parentId: d.parentId, name: d.name.trim(), kind: d.kind, code: d.code || null,
        floorMin: d.floorMin, floorMax: d.floorMax, sortOrder,
        // отбрасываем ссылки на удалённые корпуса
        spansZoneIds: d.spansZoneIds.filter((id) => buildingIdSet.has(id)),
      };
    });
    saveZones.mutate({ zones, deletedIds: [...deletedIdsRef.current] });
  };

  // ---------- группировка ----------
  const buildings = useMemo(() => draft.filter((d) => d.kind === 'building' && d.parentId == null), [draft]);
  const stylobatesStandalone = draft.filter((d) => d.kind === 'stylobate' && d.parentId == null);
  const parkings = draft.filter((d) => d.kind === 'parking');
  const techfloors = draft.filter((d) => d.kind === 'techfloor');
  const roofs = draft.filter((d) => d.kind === 'roof');
  const others = draft.filter((d) => d.kind === 'section' || d.kind === 'other');

  const colIndex = useMemo(() => {
    const m = new Map<string, number>();
    buildings.forEach((b, i) => m.set(b.id, i));
    return m;
  }, [buildings]);

  const buildingOptions = buildings.map((b) => ({ value: b.id, label: b.name }));

  // ---------- геометрия разреза ----------
  const floored = draft.filter((z) => z.floorMin != null && z.floorMax != null);
  const gMax = floored.length ? Math.max(...floored.map((z) => z.floorMax as number)) : 1;
  const gMin = floored.length ? Math.min(...floored.map((z) => z.floorMin as number)) : 1;
  const levels: number[] = [];
  for (let f = gMax; f >= gMin; f--) if (f !== 0) levels.push(f);
  const levelIndex = new Map(levels.map((f, i) => [f, i]));
  const positives = levels.filter((f) => f > 0).length;
  const plotW = buildings.length ? buildings.length * COLW + (buildings.length - 1) * GAP : 320;
  const plotH = TOPPAD + levels.length * RH;
  const groundY = TOPPAD + positives * RH;

  const floorsInRange = (min: number, max: number) => levels.filter((f) => f >= min && f <= max).length;
  const rowTopY = (floor: number) => TOPPAD + (levelIndex.get(floor) ?? 0) * RH;

  // Сегменты колонок (несвязный охват → несколько прямоугольников).
  const zoneColumns = (z: DraftZone): { x: number; w: number }[] => {
    let idxs: number[];
    if (z.parentId != null && colIndex.has(z.parentId)) idxs = [colIndex.get(z.parentId)!];
    else if (z.spansZoneIds.length) idxs = z.spansZoneIds.map((id) => colIndex.get(id)).filter((v): v is number => v != null).sort((a, b) => a - b);
    else idxs = buildings.map((_, i) => i);

    if (!buildings.length) return [{ x: 0, w: plotW }];
    if (!idxs.length) return [];
    const segs: { x: number; w: number }[] = [];
    let a = idxs[0]!; let prev = idxs[0]!;
    for (let k = 1; k <= idxs.length; k++) {
      const cur = idxs[k];
      if (cur != null && cur === prev + 1) { prev = cur; continue; }
      segs.push({ x: a * (COLW + GAP), w: (prev - a + 1) * COLW + (prev - a) * GAP });
      if (cur != null) { a = cur; prev = cur; }
    }
    return segs;
  };

  const blockColor = (kind: ZoneKind, solid: boolean) => {
    const c = ZONE_KIND_COLOR[kind];
    return { bg: c + (solid ? '26' : '38'), border: c };
  };

  // ---------- рендер ----------
  if (isLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  if (isError) {
    return (
      <Alert type="error" showIcon message="Не удалось загрузить локации объекта"
        action={<Button size="small" onClick={() => refetch()}>Повторить</Button>} />
    );
  }

  const sliceView = (
    <div style={{ flexShrink: 0 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Разрез (слева направо — корпуса)</Typography.Text>
      <div style={{ marginTop: 8, maxWidth: 560, overflowX: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
        {draft.length === 0 ? (
          <div style={{ color: '#bfbfbf', fontSize: 12, textAlign: 'center', padding: '32px 0' }}>Пустая площадка</div>
        ) : (
          <div style={{ position: 'relative', height: plotH + 18, width: AXISW + plotW + 8 }}>
            {/* ось этажей */}
            {levels.map((f) => (
              <div key={f} style={{ position: 'absolute', left: 0, top: rowTopY(f), width: AXISW - 4, height: RH, fontSize: 9, color: '#bfbfbf', textAlign: 'right', lineHeight: `${RH}px` }}>{f}</div>
            ))}
            {/* зоны */}
            <div style={{ position: 'absolute', left: AXISW, top: 0, width: plotW, height: plotH }}>
              {/* линия земли */}
              <div style={{ position: 'absolute', left: 0, top: groundY, width: plotW, borderTop: '2px solid #8c8c8c', opacity: 0.5 }} />
              {/* подписи колонок-корпусов */}
              {buildings.map((b, i) => (
                <div key={`lbl-${b.id}`} style={{ position: 'absolute', left: i * (COLW + GAP), top: plotH + 2, width: COLW, fontSize: 10, color: '#8c8c8c', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
              ))}
              {/* кровли — тонкая полоска поверх верха колонок охвата */}
              {roofs.map((z) => zoneColumns(z).map((seg, si) => {
                const { border } = blockColor('roof', false);
                return <div key={`${z.id}-${si}`} title={z.name} style={{ position: 'absolute', left: seg.x, top: 2, width: seg.w, height: 8, background: border, borderRadius: 3, opacity: 0.7 }} />;
              }))}
              {/* остальные зоны с этажностью */}
              {floored.map((z) => zoneColumns(z).map((seg, si) => {
                const solid = z.kind === 'building';
                const { bg, border } = blockColor(z.kind, solid);
                const top = rowTopY(z.floorMax as number);
                const h = floorsInRange(z.floorMin as number, z.floorMax as number) * RH;
                const Ico = ZONE_KIND_ICON[z.kind];
                return (
                  <div key={`${z.id}-${si}`} title={`${ZONE_KIND_LABEL[z.kind]} · ${z.name} · ${formatFloorRange(z.floorMin, z.floorMax)}`}
                    style={{ position: 'absolute', left: seg.x, top, width: seg.w, height: Math.max(RH, h), background: bg, border: `1px solid ${border}`, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden', boxSizing: 'border-box' }}>
                    <span style={{ color: border, display: 'inline-flex', fontSize: 12 }}><Ico /></span>
                    {h >= RH * 1.4 && <span style={{ fontSize: 10, color: '#595959', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{z.name}</span>}
                  </div>
                );
              }))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ---------- редактор ----------
  const spansSelect = (z: DraftZone, placeholder: string) => (
    <Select
      mode="multiple" allowClear size="small" disabled={!canEdit}
      style={{ minWidth: 180, maxWidth: 280 }}
      placeholder={placeholder}
      value={z.spansZoneIds.filter((id) => colIndex.has(id))}
      onChange={(v) => patch(z.id, { spansZoneIds: v })}
      options={buildingOptions}
      maxTagCount="responsive"
    />
  );

  const delBtn = (z: DraftZone) => canEdit && (
    <Popconfirm title="Удалить локацию?" description="Строки сметы этой локации станут «без локации»." onConfirm={() => removeZone(z)}>
      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
    </Popconfirm>
  );

  const rowWrap = (z: DraftZone, children: React.ReactNode) => {
    const Ico = ZONE_KIND_ICON[z.kind];
    return (
      <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ color: ZONE_KIND_COLOR[z.kind], display: 'inline-flex', fontSize: 16 }}><Ico /></span>
        <Input size="small" style={{ width: 160 }} value={z.name} disabled={!canEdit} placeholder="Название" onChange={(e) => patch(z.id, { name: e.target.value })} />
        {children}
      </div>
    );
  };

  const buildingRow = (z: DraftZone) => {
    const styl = draft.find((d) => d.kind === 'stylobate' && d.parentId === z.id);
    const stylH = styl ? (styl.floorMax ?? 0) : 0;
    return rowWrap(z, (
      <>
        <Input size="small" style={{ width: 80 }} value={z.code ?? ''} disabled={!canEdit} placeholder="Код" onChange={(e) => patch(z.id, { code: e.target.value })} />
        <Tooltip title="Надземных этажей (над стилобатом)">
          <InputNumber size="small" style={{ width: 78 }} min={1} max={200} disabled={!canEdit} addonAfter="эт." value={buildingCount(z)} onChange={(v) => applyBuilding(z.id, { count: (v as number) ?? 1 })} />
        </Tooltip>
        <Tooltip title="Стилобат в составе корпуса (сквозная нумерация): 0 — нет">
          <InputNumber size="small" style={{ width: 92 }} min={0} max={20} disabled={!canEdit} addonBefore="стил." value={stylH} onChange={(v) => applyBuilding(z.id, { stylobate: (v as number) ?? 0 })} />
        </Tooltip>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>{formatFloorRange(z.floorMin, z.floorMax)}</span>
        <span style={{ flex: 1 }} />
        {canEdit && <>
          <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => moveBuilding(z, -1)} />
          <Button type="text" size="small" icon={<ArrowRightOutlined />} onClick={() => moveBuilding(z, 1)} />
          <Tooltip title="Дублировать корпус"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => duplicate(z)} /></Tooltip>
        </>}
        {delBtn(z)}
      </>
    ));
  };

  const floorCountRow = (z: DraftZone, label: string, spansPlaceholder: string) =>
    rowWrap(z, (
      <>
        <InputNumber size="small" style={{ width: 78 }} min={1} max={200} disabled={!canEdit} addonAfter={label}
          value={rangeToFloorCount(z.floorMin, z.floorMax) || 1}
          onChange={(v) => { const r = floorCountToRange(z.kind, (v as number) ?? 1); patch(z.id, { floorMin: r.floorMin, floorMax: r.floorMax }); }} />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>{formatFloorRange(z.floorMin, z.floorMax)}</span>
        {spansSelect(z, spansPlaceholder)}
        <span style={{ flex: 1 }} />
        {delBtn(z)}
      </>
    ));

  const techRow = (z: DraftZone) =>
    rowWrap(z, (
      <>
        <Tooltip title="Этаж от (отрицательный — подземный)">
          <InputNumber size="small" style={{ width: 78 }} disabled={!canEdit} placeholder="эт. от" value={z.floorMin ?? undefined} onChange={(v) => patch(z.id, { floorMin: (v as number) ?? null })} />
        </Tooltip>
        <Tooltip title="Этаж до">
          <InputNumber size="small" style={{ width: 78 }} disabled={!canEdit} placeholder="эт. до" value={z.floorMax ?? undefined} onChange={(v) => patch(z.id, { floorMax: (v as number) ?? null })} />
        </Tooltip>
        {spansSelect(z, 'у каких корпусов')}
        <span style={{ flex: 1 }} />
        {delBtn(z)}
      </>
    ));

  const roofRow = (z: DraftZone) =>
    rowWrap(z, (
      <>
        {spansSelect(z, 'над какими корпусами')}
        <span style={{ flex: 1 }} />
        {delBtn(z)}
      </>
    ));

  const otherRow = (z: DraftZone) =>
    rowWrap(z, (<><Tag>{ZONE_KIND_LABEL[z.kind]}</Tag><span style={{ fontSize: 12, color: '#8c8c8c' }}>{formatFloorRange(z.floorMin, z.floorMax) || '—'}</span><span style={{ flex: 1 }} />{delBtn(z)}</>));

  const sectionTitle = (t: string) => <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '8px 0 4px' }}>{t}</Typography.Text>;

  const editorView = (
    <div style={{ flex: 1, minWidth: 320 }}>
      {canEdit && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Добавить:</Typography.Text>
          {BASE_LAYER_PRESETS.map((p) => (
            <Button key={p.kind} size="small" icon={<PlusOutlined />} onClick={() => addLayer(p)}>{p.label}</Button>
          ))}
        </Space>
      )}

      {draft.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Локации ещё не заданы">
          {canEdit && <Button type="primary" onClick={quickTemplate}>Быстрый шаблон: корпус + паркинг + стилобат</Button>}
        </Empty>
      ) : (
        <>
          {buildings.length > 0 && <>{sectionTitle('Корпуса')}{buildings.map(buildingRow)}</>}
          {stylobatesStandalone.length > 0 && <>{sectionTitle('Стилобаты (между корпусами)')}{stylobatesStandalone.map((z) => floorCountRow(z, 'эт.', 'между какими корпусами'))}</>}
          {parkings.length > 0 && <>{sectionTitle('Паркинг')}{parkings.map((z) => floorCountRow(z, 'подз.', 'под какими корпусами'))}</>}
          {techfloors.length > 0 && <>{sectionTitle('Техэтажи')}{techfloors.map(techRow)}</>}
          {roofs.length > 0 && <>{sectionTitle('Кровли')}{roofs.map(roofRow)}</>}
          {others.length > 0 && <><Divider style={{ margin: '12px 0 4px' }} orientation="left" plain><Typography.Text type="secondary" style={{ fontSize: 12 }}>Прочие локации</Typography.Text></Divider>{others.map(otherRow)}</>}
        </>
      )}

      {canEdit && (
        <div style={{ marginTop: 12 }}>
          <Button type="primary" loading={saveZones.isPending} disabled={!dirty} onClick={onSaveZones}>Сохранить</Button>
          {isFetching && <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>обновление…</Typography.Text>}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
          mode="multiple" allowClear disabled={!canEdit} style={{ flex: 1 }} placeholder="Типы помещений"
          value={selectedTypes} onChange={(v) => { setSelectedTypes(v); setTypesDirty(true); }}
          optionFilterProp="label"
          options={(allRoomTypes?.data ?? []).map((rt) => ({ value: rt.id, label: rt.name }))}
        />
        {canEdit && <Button type="primary" loading={saveTypes.isPending} disabled={!typesDirty} onClick={() => saveTypes.mutate(selectedTypes)}>Сохранить</Button>}
      </Space.Compact>
    </div>
  );
}
