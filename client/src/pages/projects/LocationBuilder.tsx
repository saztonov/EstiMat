import { useEffect, useRef, useState } from 'react';
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
import { useProjectZones } from '../../hooks/useProjectLocations';
import {
  type ZoneNode, type ZoneKind, type BaseLayerPreset,
  ZONE_KIND_LABEL, ZONE_KIND_ICON, ZONE_KIND_COLOR, LAYER_BASE_ORDER, BASE_LAYER_PRESETS,
  flattenZones, formatFloorRange, floorCountToRange, rangeToFloorCount,
} from '../estimates/components/location';

interface Props {
  projectId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

// Черновая зона. id есть всегда (для новых — uuid) — ссылки parentId/spansZoneIds стабильны (сервер upsert по id).
interface DraftZone {
  id: string;
  parentId: string | null;
  kind: ZoneKind;
  name: string;
  code: string | null;
  floorMin: number | null;
  floorMax: number | null;
  spansZoneIds: string[];
}

const makeId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`);

function zoneToDraft(z: ZoneNode): DraftZone {
  return {
    id: z.id, parentId: z.parent_id, kind: z.kind, name: z.name, code: z.code,
    floorMin: z.floor_min, floorMax: z.floor_max, spansZoneIds: z.spans_zone_ids ?? [],
  };
}

const buildingCount = (b: DraftZone) => (b.floorMax ?? 1) - (b.floorMin ?? 1) + 1;

// --- геометрия разреза ---
const COLW = 104;
const GAP = 22;
const TOWER_BAND_H = 150;
const TOWER_MIN = 48;
const LANE_H = 20;
const LANE_GAP = 3;
const ROOF_LANE_H = 12;

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

  const [draft, setDraft] = useState<DraftZone[]>([]);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const deletedIdsRef = useRef<string[]>([]);
  const serverIdsRef = useRef<Set<string>>(new Set());

  const markDirty = () => { dirtyRef.current = true; setDirty(true); };
  const pushDeleted = (id: string) => {
    if (serverIdsRef.current.has(id) && !deletedIdsRef.current.includes(id)) deletedIdsRef.current.push(id);
  };

  useEffect(() => {
    if (dirtyRef.current) return;
    const flat = flattenZones(zonesData?.data.roots ?? []);
    serverIdsRef.current = new Set(flat.map((z) => z.id));
    deletedIdsRef.current = [];
    setDraft(flat.map(zoneToDraft));
  }, [zonesData]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

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

  // ---------- мутации черновика ----------
  const patch = (id: string, p: Partial<DraftZone>) => {
    setDraft((prev) => prev.map((z) => (z.id === id ? { ...z, ...p } : z)));
    markDirty();
  };

  const removeZone = (z: DraftZone) => {
    setDraft((prev) => {
      const toRemove = new Set<string>([z.id]);
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

  // Корпус: число надземных этажей + высота стилобата «в составе» (сквозная нумерация).
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
          if (child) next = next.map((z) => (z.id === child.id ? { ...z, floorMin: 1, floorMax: sNew, spansZoneIds: [buildingId] } : z));
          else next = [...next, { id: makeId(), parentId: buildingId, kind: 'stylobate', name: `Стилобат (${b.name})`, code: null, floorMin: 1, floorMax: sNew, spansZoneIds: [buildingId] }];
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

    const blds = draft.filter((d) => d.kind === 'building' && d.parentId == null);
    const bIdSet = new Set(blds.map((b) => b.id));
    const zones = draft.map((d) => {
      let sortOrder: number;
      if (d.kind === 'building' && d.parentId == null) sortOrder = LAYER_BASE_ORDER.building + blds.indexOf(d) * 10;
      else if (d.kind === 'roof') sortOrder = LAYER_BASE_ORDER.roof;
      else if (d.kind === 'section' || d.kind === 'other') sortOrder = LAYER_BASE_ORDER[d.kind];
      else sortOrder = LAYER_BASE_ORDER[d.kind] ?? 0;
      return {
        id: d.id, parentId: d.parentId, name: d.name.trim(), kind: d.kind, code: d.code || null,
        floorMin: d.floorMin, floorMax: d.floorMax, sortOrder,
        spansZoneIds: d.spansZoneIds.filter((id) => bIdSet.has(id)),
      };
    });
    saveZones.mutate({ zones, deletedIds: [...deletedIdsRef.current] });
  };

  // ---------- группировка ----------
  const buildings = draft.filter((d) => d.kind === 'building' && d.parentId == null);
  const stylobates = draft.filter((d) => d.kind === 'stylobate' && d.parentId == null);
  const parkings = draft.filter((d) => d.kind === 'parking');
  const techfloors = draft.filter((d) => d.kind === 'techfloor');
  const roofs = draft.filter((d) => d.kind === 'roof');
  const others = draft.filter((d) => d.kind === 'section' || d.kind === 'other');
  const posTech = techfloors.filter((z) => (z.floorMin ?? 1) >= 0);
  const negTech = techfloors.filter((z) => (z.floorMin ?? 1) < 0);

  const colIndex = new Map<string, number>();
  buildings.forEach((b, i) => colIndex.set(b.id, i));
  const buildingOptions = buildings.map((b) => ({ value: b.id, label: b.name }));

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  if (isError) {
    return (
      <Alert type="error" showIcon message="Не удалось загрузить локации объекта"
        action={<Button size="small" onClick={() => refetch()}>Повторить</Button>} />
    );
  }

  // ---------- геометрия разреза ----------
  const n = buildings.length;
  const plotW = n ? n * (COLW + GAP) - GAP : 280;
  const colX = (i: number) => i * (COLW + GAP);
  const maxTop = Math.max(1, ...buildings.map((b) => b.floorMax ?? 1));
  const towerH = (b: DraftZone) => {
    const top = Math.max(1, b.floorMax ?? 1);
    const t = Math.sqrt(top / maxTop);
    return Math.round(TOWER_MIN + (TOWER_BAND_H - TOWER_MIN) * t);
  };

  // сегменты колонок охвата (несвязный → несколько); пустой охват = все колонки
  const zoneSegments = (z: DraftZone): { x: number; w: number }[] => {
    if (!n) return [{ x: 0, w: plotW }];
    let idxs: number[];
    if (z.spansZoneIds.length) idxs = z.spansZoneIds.map((id) => colIndex.get(id)).filter((v): v is number => v != null).sort((a, b) => a - b);
    else idxs = buildings.map((_, i) => i);
    if (!idxs.length) return [];
    const segs: { x: number; w: number }[] = [];
    let a = idxs[0]!; let prev = idxs[0]!;
    for (let k = 1; k <= idxs.length; k++) {
      const cur = idxs[k];
      if (cur != null && cur === prev + 1) { prev = cur; continue; }
      segs.push({ x: colX(a), w: (prev - a + 1) * COLW + (prev - a) * GAP });
      if (cur != null) { a = cur; prev = cur; }
    }
    return segs;
  };

  // вертикальная раскладка дорожек
  let yc = 0;
  const roofY = roofs.map((z, i) => ({ z, y: yc + i * (ROOF_LANE_H + LANE_GAP) }));
  yc += roofs.length ? roofs.length * (ROOF_LANE_H + LANE_GAP) + 2 : 0;
  const towerTop = yc; yc += TOWER_BAND_H; const towerBottom = yc;
  const posTechY = posTech.map((z, i) => ({ z, y: yc + i * (LANE_H + LANE_GAP) }));
  yc += posTech.length * (LANE_H + LANE_GAP);
  const stylY = stylobates.map((z, i) => ({ z, y: yc + i * (LANE_H + LANE_GAP) }));
  yc += stylobates.length * (LANE_H + LANE_GAP);
  yc += 2; const groundY = yc; yc += 4;
  const parkY = parkings.map((z, i) => ({ z, y: yc + i * (LANE_H + LANE_GAP) }));
  yc += parkings.length * (LANE_H + LANE_GAP);
  const negTechY = negTech.map((z, i) => ({ z, y: yc + i * (LANE_H + LANE_GAP) }));
  yc += negTech.length * (LANE_H + LANE_GAP);
  const labelsY = yc; yc += 18;
  const totalH = yc;

  const lane = (z: DraftZone, y: number, h: number) =>
    zoneSegments(z).map((seg, si) => {
      const c = ZONE_KIND_COLOR[z.kind];
      return (
        <div key={`${z.id}-${si}`} title={`${ZONE_KIND_LABEL[z.kind]} · ${z.name} · ${formatFloorRange(z.floorMin, z.floorMax)}`}
          style={{ position: 'absolute', left: seg.x, top: y, width: seg.w, height: h, background: c + '2e', border: `1px solid ${c}`, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', overflow: 'hidden', boxSizing: 'border-box' }}>
          {h >= LANE_H && <span style={{ color: c, display: 'inline-flex', fontSize: 12 }}><KindIcon kind={z.kind} /></span>}
          <span style={{ fontSize: 10.5, color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {z.name}{h >= LANE_H && formatFloorRange(z.floorMin, z.floorMax) ? ` · ${formatFloorRange(z.floorMin, z.floorMax)}` : ''}
          </span>
        </div>
      );
    });

  const sliceView = (
    <div style={{ flexShrink: 0, borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Разрез (слева направо — корпуса)</Typography.Text>
      <div style={{ marginTop: 6, overflowX: 'auto', overflowY: 'hidden' }}>
        {draft.length === 0 ? (
          <div style={{ color: '#bfbfbf', fontSize: 12, padding: '28px 0', textAlign: 'center' }}>Пустая площадка — добавьте корпус</div>
        ) : (
          <div style={{ position: 'relative', width: plotW + 4, height: totalH }}>
            {/* кровли */}
            {roofY.map(({ z, y }) => lane(z, y, ROOF_LANE_H))}
            {/* корпуса (башни) */}
            {buildings.map((b, i) => {
              const h = towerH(b);
              const top = towerBottom - h;
              const styl = draft.find((d) => d.kind === 'stylobate' && d.parentId === b.id);
              const s = styl ? (styl.floorMax ?? 0) : 0;
              const baseFrac = b.floorMax ? Math.min(1, s / b.floorMax) : 0;
              const baseH = Math.round(h * baseFrac);
              const cB = ZONE_KIND_COLOR.building;
              const cS = ZONE_KIND_COLOR.stylobate;
              return (
                <div key={b.id} title={`${b.name} · ${formatFloorRange(b.floorMin, b.floorMax)}`}
                  style={{ position: 'absolute', left: colX(i), top, width: COLW, height: h, background: cB + '22', border: `1px solid ${cB}`, borderRadius: 4, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <span style={{ color: cB, display: 'inline-flex', fontSize: 14 }}><KindIcon kind="building" /></span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: COLW - 8 }}>{b.name}</span>
                  <span style={{ fontSize: 10, color: '#8c8c8c' }}>{buildingCount(b)} эт.</span>
                  {baseH > 0 && (
                    <div title={`Стилобат · эт. 1–${s}`} style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: baseH, background: cS + '40', borderTop: `1px solid ${cS}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 9, color: '#8a5a12', whiteSpace: 'nowrap' }}>стилобат {s} эт.</span>
                    </div>
                  )}
                </div>
              );
            })}
            {/* надземные техэтажи и стилобаты-подиумы */}
            {posTechY.map(({ z, y }) => lane(z, y, LANE_H))}
            {stylY.map(({ z, y }) => lane(z, y, LANE_H))}
            {/* линия земли */}
            <div style={{ position: 'absolute', left: 0, top: groundY, width: plotW, borderTop: '2px solid #8c8c8c' }} />
            <span style={{ position: 'absolute', left: 0, top: groundY - 12, fontSize: 9, color: '#bfbfbf' }}>0 — земля</span>
            {/* подземное */}
            {parkY.map(({ z, y }) => lane(z, y, LANE_H))}
            {negTechY.map(({ z, y }) => lane(z, y, LANE_H))}
            {/* подписи колонок */}
            {buildings.map((b, i) => (
              <div key={`lbl-${b.id}`} style={{ position: 'absolute', left: colX(i), top: labelsY, width: COLW, fontSize: 10, color: '#8c8c8c', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ---------- редактор ----------
  const spansSelect = (z: DraftZone, placeholder: string) => (
    <Select mode="multiple" allowClear size="small" disabled={!canEdit}
      style={{ minWidth: 170, maxWidth: 260 }} placeholder={placeholder}
      value={z.spansZoneIds.filter((id) => colIndex.has(id))}
      onChange={(v) => patch(z.id, { spansZoneIds: v })}
      options={buildingOptions} maxTagCount="responsive" />
  );

  const delBtn = (z: DraftZone) => canEdit && (
    <Popconfirm title="Удалить локацию?" description="Строки сметы этой локации станут «без локации»." onConfirm={() => removeZone(z)}>
      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
    </Popconfirm>
  );

  const rowWrap = (z: DraftZone, children: React.ReactNode) => (
    <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={{ color: ZONE_KIND_COLOR[z.kind], display: 'inline-flex', fontSize: 16 }}><KindIcon kind={z.kind} /></span>
      <Input size="small" style={{ width: 150 }} value={z.name} disabled={!canEdit} placeholder="Название" onChange={(e) => patch(z.id, { name: e.target.value })} />
      {children}
    </div>
  );

  const buildingRow = (z: DraftZone) => {
    const styl = draft.find((d) => d.kind === 'stylobate' && d.parentId === z.id);
    const stylH = styl ? (styl.floorMax ?? 0) : 0;
    return rowWrap(z, (
      <>
        <Input size="small" style={{ width: 76 }} value={z.code ?? ''} disabled={!canEdit} placeholder="Код" onChange={(e) => patch(z.id, { code: e.target.value })} />
        <Tooltip title="Надземных этажей (над стилобатом)">
          <InputNumber size="small" style={{ width: 76 }} min={1} max={200} disabled={!canEdit} addonAfter="эт." value={buildingCount(z)} onChange={(v) => applyBuilding(z.id, { count: (v as number) ?? 1 })} />
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
        <InputNumber size="small" style={{ width: 76 }} min={1} max={200} disabled={!canEdit} addonAfter={label}
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
          <InputNumber size="small" style={{ width: 76 }} disabled={!canEdit} placeholder="эт. от" value={z.floorMin ?? undefined} onChange={(v) => patch(z.id, { floorMin: (v as number) ?? null })} />
        </Tooltip>
        <Tooltip title="Этаж до">
          <InputNumber size="small" style={{ width: 76 }} disabled={!canEdit} placeholder="эт. до" value={z.floorMax ?? undefined} onChange={(v) => patch(z.id, { floorMax: (v as number) ?? null })} />
        </Tooltip>
        {spansSelect(z, 'у каких корпусов')}
        <span style={{ flex: 1 }} />
        {delBtn(z)}
      </>
    ));

  const roofRow = (z: DraftZone) =>
    rowWrap(z, (<>{spansSelect(z, 'над какими корпусами')}<span style={{ flex: 1 }} />{delBtn(z)}</>));

  const otherRow = (z: DraftZone) =>
    rowWrap(z, (<><Tag>{ZONE_KIND_LABEL[z.kind]}</Tag><span style={{ fontSize: 12, color: '#8c8c8c' }}>{formatFloorRange(z.floorMin, z.floorMax) || '—'}</span><span style={{ flex: 1 }} />{delBtn(z)}</>));

  const sectionTitle = (t: string) => <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '8px 0 4px' }}>{t}</Typography.Text>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {sliceView}

      {canEdit && (
        <Space wrap style={{ flexShrink: 0, padding: '10px 0 8px' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Добавить:</Typography.Text>
          {BASE_LAYER_PRESETS.map((p) => (
            <Button key={p.kind} size="small" icon={<PlusOutlined />} onClick={() => addLayer(p)}>{p.label}</Button>
          ))}
        </Space>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {draft.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Локации ещё не заданы">
            {canEdit && <Button type="primary" onClick={quickTemplate}>Быстрый шаблон: корпус + паркинг + стилобат</Button>}
          </Empty>
        ) : (
          <>
            {buildings.length > 0 && <>{sectionTitle('Корпуса')}{buildings.map(buildingRow)}</>}
            {stylobates.length > 0 && <>{sectionTitle('Стилобаты (между корпусами)')}{stylobates.map((z) => floorCountRow(z, 'эт.', 'между какими корпусами'))}</>}
            {parkings.length > 0 && <>{sectionTitle('Паркинг')}{parkings.map((z) => floorCountRow(z, 'подз.', 'под какими корпусами'))}</>}
            {techfloors.length > 0 && <>{sectionTitle('Техэтажи')}{techfloors.map(techRow)}</>}
            {roofs.length > 0 && <>{sectionTitle('Кровли')}{roofs.map(roofRow)}</>}
            {others.length > 0 && <><Divider style={{ margin: '12px 0 4px' }} orientation="left" plain><Typography.Text type="secondary" style={{ fontSize: 12 }}>Прочие локации</Typography.Text></Divider>{others.map(otherRow)}</>}
          </>
        )}
      </div>

      {canEdit && (
        <div style={{ flexShrink: 0, borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
          <Button type="primary" loading={saveZones.isPending} disabled={!dirty} onClick={onSaveZones}>Сохранить</Button>
          {isFetching && <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>обновление…</Typography.Text>}
        </div>
      )}
    </div>
  );
}
