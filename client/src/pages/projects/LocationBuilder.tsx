import { useEffect, useRef, useState } from 'react';
import {
  Button, Input, InputNumber, Select, Popconfirm, Space, Tag, Typography,
  Alert, Spin, Empty, App, Modal,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, CopyOutlined, ArrowLeftOutlined, ArrowRightOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FLOOR_MIN, FLOOR_MAX } from '@estimat/shared';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { useAuthStore } from '../../store/authStore';
import { useProjectZones } from '../../hooks/useProjectLocations';
import {
  type ZoneNode, type ZoneKind, type BaseLayerPreset,
  ZONE_KIND_LABEL, ZONE_KIND_ICON, ZONE_KIND_COLOR, LAYER_BASE_ORDER, BASE_LAYER_PRESETS,
  flattenZones, formatFloorRange,
} from '../estimates/components/location';

interface Props {
  projectId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

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

// --- геометрия разреза (линейная шкала этажей) ---
const COLW = 104;
const GAP = 22;
const AXIS_W = 32;
const FLOOR_PX_MIN = 9;
const FLOOR_PX_MAX = 26;
const PLOT_MAX_H = 520;
const LABELS_H = 18;
// слот этажа без «дыры нуля»: 1→0, 2→1, -1→-1, -2→-2
const slot = (f: number) => (f > 0 ? f - 1 : f);

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
  const [editingId, setEditingId] = useState<string | null>(null);
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
    const d = flat
      .map(zoneToDraft)
      // «Улицу» в конструкторе не показываем — она остаётся на сервере и доступна в списке локаций сметы.
      // (нет в draft → не попадёт ни в zones, ни в deletedIds payload → bulk её не трогает)
      .filter((z) => z.kind !== 'street')
      .map((z) => {
        // legacy «стилобат в составе» (parent_id) → охват ровно этого корпуса
        if (z.kind === 'stylobate' && z.parentId) {
          return { ...z, spansZoneIds: z.spansZoneIds.length ? z.spansZoneIds : [z.parentId], parentId: null };
        }
        // корпус всегда нумеруется с 1-го этажа (убираем legacy-сдвиг сквозной нумерации)
        if (z.kind === 'building' && z.parentId == null && z.floorMin != null && z.floorMax != null && z.floorMin > 1) {
          return { ...z, floorMax: z.floorMax - z.floorMin + 1, floorMin: 1 };
        }
        return z;
      });
    setDraft(d);
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
    if (z.kind === 'street') return; // Улица неудаляемая
    setDraft((prev) => {
      const toRemove = new Set<string>([z.id]);
      prev.forEach((c) => { if (c.parentId === z.id) toRemove.add(c.id); });
      toRemove.forEach(pushDeleted);
      return prev.filter((x) => !toRemove.has(x.id));
    });
    setEditingId(null);
    markDirty();
  };

  const addAndEdit = (preset: BaseLayerPreset) => {
    const sameKind = draft.filter((d) => d.kind === preset.kind && d.parentId == null).length;
    const id = makeId();
    setDraft((prev) => [...prev, {
      id, parentId: null, kind: preset.kind,
      name: `${preset.defaultName}${sameKind > 0 ? ` ${sameKind + 1}` : ''}`,
      code: null, floorMin: preset.defaultFloorMin, floorMax: preset.defaultFloorMax, spansZoneIds: [],
    }]);
    markDirty();
    setEditingId(id);
  };

  const duplicate = (z: DraftZone) => {
    const id = makeId();
    setDraft((prev) => {
      const i = prev.findIndex((x) => x.id === z.id);
      const copy: DraftZone = { ...z, id, parentId: null, name: `${z.name} (копия)`, spansZoneIds: [...z.spansZoneIds] };
      const arr = [...prev];
      arr.splice(i + 1, 0, copy);
      return arr;
    });
    markDirty();
    setEditingId(id);
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

  // «Стилобат корпуса» = стилобат-зона с охватом РОВНО этого корпуса (источник истины — spans, не parent_id).
  const buildingStylobate = (zones: DraftZone[], buildingId: string) =>
    zones.find((z) => z.kind === 'stylobate' && z.spansZoneIds.length === 1 && z.spansZoneIds[0] === buildingId);

  // Корпус: число надземных этажей (всегда с 1-го) + высота персонального стилобата (цоколь, не сдвигает нумерацию).
  const applyBuilding = (buildingId: string, opts: { count?: number; stylobate?: number }) => {
    setDraft((prev) => {
      const b = prev.find((z) => z.id === buildingId);
      if (!b) return prev;
      let next = [...prev];
      if (opts.stylobate !== undefined) {
        const sNew = Math.max(0, Math.round(opts.stylobate));
        const child = buildingStylobate(next, buildingId);
        if (sNew > 0) {
          if (child) next = next.map((z) => (z.id === child.id ? { ...z, floorMin: 1, floorMax: sNew } : z));
          else next = [...next, { id: makeId(), parentId: null, kind: 'stylobate', name: `Стилобат (${b.name})`, code: null, floorMin: 1, floorMax: sNew, spansZoneIds: [buildingId] }];
        } else if (child) { pushDeleted(child.id); next = next.filter((z) => z.id !== child.id); }
      }
      if (opts.count !== undefined) {
        const newMax = Math.max(1, Math.round(opts.count));
        next = next.map((z) => (z.id === buildingId ? { ...z, floorMin: 1, floorMax: newMax } : z));
      }
      return next;
    });
    markDirty();
  };

  const onSaveZones = () => {
    if (draft.some((d) => !d.name.trim())) { message.error('У каждого местоположения должно быть название'); return; }
    const bad = draft.find((d) => d.floorMin != null && d.floorMax != null && d.floorMin > d.floorMax);
    if (bad) { message.error(`«${bad.name}»: нижний этаж больше верхнего`); return; }

    const blds = draft.filter((d) => d.kind === 'building' && d.parentId == null);
    const bIdSet = new Set(blds.map((b) => b.id));
    const zones = draft.map((d) => {
      let sortOrder: number;
      if (d.kind === 'building' && d.parentId == null) sortOrder = LAYER_BASE_ORDER.building + blds.indexOf(d) * 10;
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
  const podiums = draft.filter((d) => d.kind === 'parking' || d.kind === 'stylobate' || d.kind === 'techfloor');
  const others = draft.filter((d) => d.kind === 'section' || d.kind === 'other');
  // legacy roof — скрыт полностью, но остаётся в draft/payload без изменений.

  const colIndex = new Map<string, number>();
  buildings.forEach((b, i) => colIndex.set(b.id, i));
  const buildingOptions = buildings.map((b) => ({ value: b.id, label: b.name }));

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  if (isError) {
    return (
      <Alert type="error" showIcon message="Не удалось загрузить местоположения объекта"
        action={<Button size="small" onClick={() => refetch()}>Повторить</Button>} />
    );
  }

  // ---------- шкала ----------
  const floored = draft.filter((z) => z.floorMin != null && z.floorMax != null);
  const top = floored.length ? Math.max(...floored.map((z) => z.floorMax as number)) : 1;
  const bottom = floored.length ? Math.min(...floored.map((z) => z.floorMin as number)) : 1;
  const slotsCount = Math.max(1, slot(top) - slot(bottom) + 1);
  const floorPx = Math.min(FLOOR_PX_MAX, Math.max(FLOOR_PX_MIN, PLOT_MAX_H / slotsCount));
  const plotH = slotsCount * floorPx;
  const rowTopY = (f: number) => (slot(top) - slot(f)) * floorPx;
  const blockTop = (z: DraftZone) => rowTopY(z.floorMax as number);
  const blockH = (z: DraftZone) => (slot(z.floorMax as number) - slot(z.floorMin as number) + 1) * floorPx;
  const groundY = (slot(top) + 1) * floorPx; // низ этажа 1
  const n = buildings.length;
  const plotW = n ? n * (COLW + GAP) - GAP : 280;
  const colX = (i: number) => i * (COLW + GAP);

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

  // метки оси этажей
  const floorsList: number[] = [];
  for (let f = top; f >= bottom; f--) if (f !== 0) floorsList.push(f);
  const labelStep = floorPx >= 18 ? 1 : floorPx >= 12 ? 5 : 10;
  const showLabel = (f: number) => f === 1 || f === -1 || f === top || f === bottom || f % labelStep === 0;

  const sliceView = (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--est-border)', borderRadius: 8, padding: 8 }}>
      {draft.length === 0 ? (
        <div style={{ color: 'var(--est-text-quaternary)', fontSize: 12, padding: '28px 0', textAlign: 'center' }}>Пустая площадка — добавьте корпус</div>
      ) : (
        <div style={{ position: 'relative', width: AXIS_W + plotW + 4, height: plotH + LABELS_H }}>
          {/* ось этажей */}
          {floorsList.filter(showLabel).map((f) => (
            <div key={`ax-${f}`} style={{ position: 'absolute', left: 0, top: rowTopY(f), width: AXIS_W - 4, height: floorPx, fontSize: 9, color: 'var(--est-text-quaternary)', textAlign: 'right', lineHeight: `${Math.max(floorPx, 10)}px`, overflow: 'hidden' }}>{f}</div>
          ))}

          {/* зоны (плоскость со смещением на ось) */}
          <div style={{ position: 'absolute', left: AXIS_W, top: 0, width: plotW, height: plotH }}>
            {/* башни корпусов */}
            {buildings.map((b, i) => {
              const cB = ZONE_KIND_COLOR.building;
              return (
                <div key={b.id} title={`${b.name} · ${formatFloorRange(b.floorMin, b.floorMax)}`}
                  onClick={() => setEditingId(b.id)}
                  style={{ position: 'absolute', left: colX(i), top: blockTop(b), width: COLW, height: Math.max(20, blockH(b)), background: cB + '1f', border: `1px solid ${cB}`, borderRadius: 4, boxSizing: 'border-box', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <span style={{ color: cB, display: 'inline-flex', fontSize: 14 }}><KindIcon kind="building" /></span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--est-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: COLW - 8 }}>{b.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--est-text-tertiary)' }}>{buildingCount(b)} эт.</span>
                </div>
              );
            })}

            {/* подиумы: паркинг / стилобат / техэтаж — на своих этажах в колонках охвата */}
            {podiums.map((z) => zoneSegments(z).map((seg, si) => {
              const c = ZONE_KIND_COLOR[z.kind];
              const h = Math.max(18, blockH(z));
              const range = formatFloorRange(z.floorMin, z.floorMax);
              return (
                <div key={`${z.id}-${si}`} title={`${ZONE_KIND_LABEL[z.kind]} · ${z.name} · ${range}`}
                  onClick={() => setEditingId(z.id)}
                  style={{ position: 'absolute', left: seg.x, top: blockTop(z), width: seg.w, height: h, background: c + '33', border: `1px solid ${c}`, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', overflow: 'hidden', cursor: 'pointer', boxSizing: 'border-box', zIndex: 2 }}>
                  <span style={{ color: c, display: 'inline-flex', fontSize: 11, flexShrink: 0 }}><KindIcon kind={z.kind} /></span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--est-text)', whiteSpace: 'nowrap', flexShrink: 0 }}>{range}</span>
                  <span style={{ fontSize: 10, color: 'var(--est-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{z.name}</span>
                </div>
              );
            }))}

            {/* линия земли */}
            <div style={{ position: 'absolute', left: 0, top: groundY, width: plotW, borderTop: '2px solid var(--est-text-tertiary)', zIndex: 3 }} />

            {/* подписи колонок */}
            {buildings.map((b, i) => (
              <div key={`lbl-${b.id}`} style={{ position: 'absolute', left: colX(i), top: plotH + 2, width: COLW, fontSize: 10, color: 'var(--est-text-tertiary)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ---------- модалка редактирования объекта ----------
  const editing = draft.find((z) => z.id === editingId) || null;
  const editModal = editing && (
    <Modal
      open
      title={`${ZONE_KIND_LABEL[editing.kind]}${editing.kind === 'building' ? '' : ''}`}
      onCancel={() => setEditingId(null)}
      footer={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {editing.kind !== 'street' && canEdit && (
            <Button key="dup" icon={<CopyOutlined />} onClick={() => duplicate(editing)}>Дублировать</Button>
          )}
          {editing.kind !== 'street' && canEdit && (
            <Popconfirm key="del" title="Удалить местоположение?" description="Строки сметы этого местоположения станут «без местоположения»." onConfirm={() => removeZone(editing)}>
              <Button danger icon={<DeleteOutlined />}>Удалить</Button>
            </Popconfirm>
          )}
          <Button key="ok" type="primary" onClick={() => setEditingId(null)} style={{ marginLeft: 'auto' }}>Готово</Button>
        </div>
      }
      width={modalWidth(460)}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Название</Typography.Text>
          <Input value={editing.name} disabled={!canEdit} onChange={(e) => patch(editing.id, { name: e.target.value })} />
        </div>

        {editing.kind === 'building' && (() => {
          const styl = buildingStylobate(draft, editing.id);
          const stylH = styl ? (styl.floorMax ?? 0) : 0;
          return (
            <>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Код</Typography.Text>
                <Input value={editing.code ?? ''} disabled={!canEdit} onChange={(e) => patch(editing.id, { code: e.target.value })} />
              </div>
              <Space size="large" wrap>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Надземных этажей</Typography.Text>
                  <InputNumber controls={false} min={1} max={FLOOR_MAX} disabled={!canEdit} style={{ width: 120 }} value={buildingCount(editing)} onChange={(v) => applyBuilding(editing.id, { count: (v as number) ?? 1 })} />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Стилобат в составе, эт. (0 — нет)</Typography.Text>
                  <InputNumber controls={false} min={0} max={20} disabled={!canEdit} style={{ width: 120 }} value={stylH} onChange={(v) => applyBuilding(editing.id, { stylobate: (v as number) ?? 0 })} />
                </div>
              </Space>
              <Typography.Text style={{ fontSize: 12, color: 'var(--est-text-tertiary)' }}>
                Итог: {formatFloorRange(editing.floorMin, editing.floorMax)}{stylH > 0 ? ` · стилобат эт. 1–${stylH}` : ''}
              </Typography.Text>
              {canEdit && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>Порядок в ряду:</Typography.Text>
                  <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => moveBuilding(editing, -1)} />
                  <Button size="small" icon={<ArrowRightOutlined />} onClick={() => moveBuilding(editing, 1)} style={{ marginLeft: 4 }} />
                </div>
              )}
            </>
          );
        })()}

        {(editing.kind === 'parking' || editing.kind === 'stylobate' || editing.kind === 'techfloor') && (
          <>
            <Space size="large">
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Этаж от{editing.kind === 'parking' ? ' (−)' : ''}</Typography.Text>
                <InputNumber controls={false} min={FLOOR_MIN} max={FLOOR_MAX} disabled={!canEdit} style={{ width: 110 }} value={editing.floorMin ?? undefined} onChange={(v) => patch(editing.id, { floorMin: (v as number) ?? null })} />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Этаж до</Typography.Text>
                <InputNumber controls={false} min={FLOOR_MIN} max={FLOOR_MAX} disabled={!canEdit} style={{ width: 110 }} value={editing.floorMax ?? undefined} onChange={(v) => patch(editing.id, { floorMax: (v as number) ?? null })} />
              </div>
            </Space>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                {editing.kind === 'parking' ? 'Под какими корпусами' : editing.kind === 'stylobate' ? 'Между/под какими корпусами' : 'У каких корпусов'} (пусто = все)
              </Typography.Text>
              <Select mode="multiple" allowClear disabled={!canEdit} style={{ width: '100%' }} placeholder="Все корпуса"
                value={editing.spansZoneIds.filter((id) => colIndex.has(id))}
                onChange={(v) => patch(editing.id, { spansZoneIds: v })} options={buildingOptions} maxTagCount="responsive" />
            </div>
          </>
        )}

        {editing.kind === 'street' && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Наружное местоположение (благоустройство, сети). Есть всегда, без этажей. Удалить нельзя.
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {canEdit && (
        <Space wrap style={{ flexShrink: 0, paddingBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Добавить:</Typography.Text>
          {BASE_LAYER_PRESETS.map((p) => (
            <Button key={p.kind} size="small" icon={<PlusOutlined />} onClick={() => addAndEdit(p)}>{p.label}</Button>
          ))}
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>Клик по объекту — настройка</Typography.Text>
        </Space>
      )}

      {draft.length === 0 && canEdit ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Местоположения ещё не заданы" style={{ flex: 1 }} />
      ) : sliceView}

      {others.length > 0 && (
        <div style={{ flexShrink: 0, paddingTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>Прочие местоположения:</Typography.Text>
          <Space wrap size={4}>
            {others.map((z) => (
              <Tag key={z.id} style={{ cursor: 'pointer' }} onClick={() => setEditingId(z.id)}>
                {z.name} {formatFloorRange(z.floorMin, z.floorMax)}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      {canEdit && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--est-border)', paddingTop: 10, marginTop: 8 }}>
          <Button type="primary" loading={saveZones.isPending} disabled={!dirty} onClick={onSaveZones}>Сохранить</Button>
          {isFetching && <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>обновление…</Typography.Text>}
        </div>
      )}

      {editModal}
    </div>
  );
}
