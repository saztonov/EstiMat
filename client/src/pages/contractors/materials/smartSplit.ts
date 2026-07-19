// Разбивка строк ИИ-группы по корпусам/этажам/виду работ ВНУТРИ готового блока (read-only).
//
// Умная группировка считает состав блоков; корпус, этаж и вид работ здесь не границы, а способ
// посмотреть. Разложение occurrence-level: одна атомарная строка материала показывается в нескольких
// корпусах с фактическими количествами (сумма по корпусам = количеству строки — доле подрядчика).
// «Заказано»/«Остаток»/заявка остаются на атомарной строке (у заявок нет локационного измерения).
import { useCallback, useMemo } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import type { OrderMaterialRow } from './orderRow';
import {
  countLocationCells,
  formatFloors,
  type LocationSnapshot,
  type ZoneIndex,
  type ZoneNode,
} from '../../estimates/components/location';

/** Оси разбивки. Категория/операция уже заданы ИИ-группой — здесь только внутриблочные уровни. */
export interface SmartSplitLevels {
  costType: boolean;
  location: boolean;
  locationType: boolean;
}

export const DEFAULT_SMART_SPLIT: SmartSplitLevels = { costType: false, location: false, locationType: false };

function sanitize(v: SmartSplitLevels | null | undefined): SmartSplitLevels {
  return {
    costType: typeof v?.costType === 'boolean' ? v.costType : false,
    location: typeof v?.location === 'boolean' ? v.location : false,
    locationType: typeof v?.locationType === 'boolean' ? v.locationType : false,
  };
}

/**
 * Личная настройка разбивки внутри ИИ-блоков (localStorage). Результат ИИ общий для scope, а
 * разбивка — способ смотреть, поэтому она персональная и не влияет на расчёт.
 */
export function useSmartSplit() {
  const [raw, setRaw] = usePersistedState<SmartSplitLevels>(
    'estimat:contractors-materials-split-smart',
    DEFAULT_SMART_SPLIT,
  );
  const levels = useMemo(() => sanitize(raw), [raw]);
  const setLevels = useCallback((next: SmartSplitLevels) => setRaw(sanitize(next)), [setRaw]);
  const toggle = useCallback(
    (key: keyof SmartSplitLevels, value: boolean) => setLevels({ ...levels, [key]: value }),
    [levels, setLevels],
  );
  const reset = useCallback(() => setLevels(DEFAULT_SMART_SPLIT), [setLevels]);
  const changedFromDefault = useMemo(
    () => (['costType', 'location', 'locationType'] as const).filter((k) => levels[k] !== DEFAULT_SMART_SPLIT[k]).length,
    [levels],
  );
  const active = levels.costType || levels.location || levels.locationType;
  return { levels, toggle, reset, changedFromDefault, active };
}

const NO_ZONE = 'Без корпуса';
const NO_TYPE = 'Без типа';

/** Один срез строки материала: её вклад в конкретный (вид работ × корпус × тип). */
interface RowSlice {
  costTypeId: string | null;
  costTypeName: string | null;
  zoneKey: string;
  zoneName: string | null;
  floors: number[];
  typeId: string;
  typeName: string | null;
  quantity: number;
}

/** Разложить вхождение на количества по корпусам. Сумма qty = quantity вхождения. */
function occurrenceZoneQuantities(
  loc: LocationSnapshot,
  quantity: number,
  roots: ZoneNode[],
): { zoneId: string | null; zoneName: string | null; floors: number[]; qty: number }[] {
  const locs = loc.locations ?? [];
  if (locs.length === 0) {
    // Legacy-строка (до бэкфилла мультилокации): одна зона на весь объём.
    const floors: number[] = [];
    if (loc.floorFrom != null && loc.floorTo != null) {
      for (let f = loc.floorFrom; f <= loc.floorTo; f++) if (f !== 0) floors.push(f);
    } else if (loc.floorFrom != null) floors.push(loc.floorFrom);
    return [{ zoneId: loc.zoneId, zoneName: loc.zoneName, floors, qty: quantity }];
  }
  // Мультизона: доля зоны = доля её ячеек «зона×этаж». Σ qty = quantity (perCell × Σ cells).
  const perCell = quantity / countLocationCells(locs, roots);
  return locs.map((l) => ({
    zoneId: l.zoneId,
    zoneName: null,
    floors: l.floors ?? [],
    qty: perCell * countLocationCells([{ zoneId: l.zoneId, floors: l.floors ?? [] }], roots),
  }));
}

/** Разложить строку на срезы по её вхождениям. Сумма quantity срезов = quantity строки (доле). */
function buildRowSlices(row: OrderMaterialRow, roots: ZoneNode[], zoneIndex: ZoneIndex): RowSlice[] {
  const rawTotal = row.occurrences.reduce((s, o) => s + o.quantity, 0);
  // Нормируем к quantity строки: occurrences сметные, а строка масштабирована по доле подрядчика.
  const factor = rawTotal > 0 ? row.quantity / rawTotal : 0;
  const byKey = new Map<string, RowSlice>();

  for (const occ of row.occurrences) {
    const typeId = occ.location.locationTypeId ?? '';
    const typeName = occ.location.locationTypeName ?? null;

    for (const z of occurrenceZoneQuantities(occ.location, occ.quantity, roots)) {
      const zoneKey = z.zoneId ?? 'no-zone';
      const key = `${zoneKey}|${typeId}`;
      let slice = byKey.get(key);
      if (!slice) {
        slice = {
          costTypeId: row.costTypeId,
          costTypeName: row.costTypeName,
          zoneKey,
          zoneName: z.zoneId ? (zoneIndex.get(z.zoneId) ?? z.zoneName) : z.zoneName,
          floors: [],
          typeId,
          typeName,
          quantity: 0,
        };
        byKey.set(key, slice);
      }
      slice.quantity += z.qty * factor;
      for (const f of z.floors) if (!slice.floors.includes(f)) slice.floors.push(f);
    }
  }
  return [...byKey.values()];
}

/** Строка внутри листового узла разбивки: атомарная строка + её количество в этом срезе. */
export interface SplitLeafRow {
  row: OrderMaterialRow;
  quantity: number;
}

export interface SplitNode {
  key: string;
  level: 'costType' | 'location' | 'locationType';
  label: string;
  /** Бейджи корпуса (только у уровня location). */
  badges: { zoneNames: string[]; floorsLabel: string } | null;
  rowCount: number;
  children: SplitNode[];
  /** Непусто только у листового уровня. */
  leaves: SplitLeafRow[];
}

interface LevelSpec {
  level: SplitNode['level'];
  keyOf: (s: RowSlice) => string;
  label: (s: RowSlice) => string;
  isEmpty: (s: RowSlice) => boolean;
}

function specsFor(levels: SmartSplitLevels): LevelSpec[] {
  const specs: LevelSpec[] = [];
  if (levels.costType) {
    specs.push({
      level: 'costType',
      keyOf: (s) => `ct:${s.costTypeId ?? ''}`,
      label: (s) => s.costTypeName ?? 'Без вида работ',
      isEmpty: (s) => !s.costTypeId,
    });
  }
  if (levels.location) {
    specs.push({
      level: 'location',
      keyOf: (s) => `loc:${s.zoneKey}`,
      label: (s) => s.zoneName ?? NO_ZONE,
      isEmpty: (s) => s.zoneKey === 'no-zone',
    });
  }
  if (levels.locationType) {
    specs.push({
      level: 'locationType',
      keyOf: (s) => `lt:${s.typeId}`,
      label: (s) => s.typeName ?? NO_TYPE,
      isEmpty: (s) => !s.typeId,
    });
  }
  return specs;
}

interface Bucket {
  slices: { row: OrderMaterialRow; slice: RowSlice }[];
  sample: RowSlice;
}

function buildLevel(
  items: { row: OrderMaterialRow; slice: RowSlice }[],
  specs: LevelSpec[],
  depth: number,
  parentKey: string,
): SplitNode[] {
  const spec = specs[depth]!;
  const buckets = new Map<string, Bucket>();
  for (const it of items) {
    const key = spec.keyOf(it.slice);
    let b = buckets.get(key);
    if (!b) {
      b = { slices: [], sample: it.slice };
      buckets.set(key, b);
    }
    b.slices.push(it);
  }

  const isLeaf = depth === specs.length - 1;
  const nodes = [...buckets].map(([key, b]) => {
    const nodeKey = parentKey ? `${parentKey}/${key}` : key;
    // Лист: свернуть срезы по строке (у строки в одном листе может быть несколько срезов —
    // например разные этажи одной зоны свёрнуты в один узел location).
    const leaves: SplitLeafRow[] = [];
    if (isLeaf) {
      const byRow = new Map<string, SplitLeafRow>();
      for (const it of b.slices) {
        let lr = byRow.get(it.row.orderKey);
        if (!lr) {
          lr = { row: it.row, quantity: 0 };
          byRow.set(it.row.orderKey, lr);
        }
        lr.quantity += it.slice.quantity;
      }
      leaves.push(...[...byRow.values()].sort((a, b2) => a.row.name.localeCompare(b2.row.name, 'ru')));
    }
    // Бейджи корпуса: этажи собираем со ВСЕХ строк зоны, а не с первой — иначе подпись «эт. 1»
    // вместо «эт. 1-3», когда строки зоны стоят на разных этажах.
    const badges =
      spec.level === 'location'
        ? {
            zoneNames: b.sample.zoneName ? [b.sample.zoneName] : [],
            floorsLabel: formatFloors(b.slices.flatMap((s) => s.slice.floors)),
          }
        : null;
    const node: SplitNode = {
      key: nodeKey,
      level: spec.level,
      label: spec.label(b.sample),
      badges,
      rowCount: new Set(b.slices.map((s) => s.row.orderKey)).size,
      children: isLeaf ? [] : buildLevel(b.slices, specs, depth + 1, nodeKey),
      leaves,
    };
    return { node, empty: spec.isEmpty(b.sample) };
  });

  if (spec.level === 'location' || spec.level === 'locationType') {
    nodes.sort((a, b) => a.node.label.localeCompare(b.node.label, 'ru'));
  }
  nodes.sort((a, b) => Number(a.empty) - Number(b.empty));
  return nodes.map((n) => n.node);
}

/**
 * Построить дерево разбивки блока по включённым осям. Пустой список уровней или пустой вход → [].
 * Ключи узлов — в пространстве переданного prefix (ключа ИИ-группы), чтобы «Свернуть всё» и
 * состояние сворачивания не пересекались между блоками.
 */
export function buildSplitTree(
  rows: OrderMaterialRow[],
  levels: SmartSplitLevels,
  roots: ZoneNode[],
  zoneIndex: ZoneIndex,
  prefix: string,
): SplitNode[] {
  const specs = specsFor(levels);
  if (specs.length === 0 || rows.length === 0) return [];
  const items = rows.flatMap((row) => buildRowSlices(row, roots, zoneIndex).map((slice) => ({ row, slice })));
  return buildLevel(items, specs, 0, prefix);
}

/** Все ключи узлов поддерева — для «Свернуть всё». */
export function collectSplitKeys(nodes: SplitNode[]): string[] {
  const out: string[] = [];
  const walk = (list: SplitNode[]) => {
    for (const n of list) {
      out.push(n.key);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
