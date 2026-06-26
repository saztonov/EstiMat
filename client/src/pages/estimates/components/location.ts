// Типы и утилиты локализации для клиента (зоны объекта + типы помещений).
import type { ComponentType } from 'react';
import {
  BankOutlined,
  CarOutlined,
  BuildOutlined,
  ApartmentOutlined,
  ToolOutlined,
  BorderTopOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
} from '@ant-design/icons';

export type ZoneKind = 'building' | 'parking' | 'stylobate' | 'section' | 'roof' | 'other' | 'techfloor' | 'street';

export interface ZoneNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  kind: ZoneKind;
  code: string | null;
  floor_min: number | null;
  floor_max: number | null;
  sort_order: number;
  spans_zone_ids: string[];
  children: ZoneNode[];
}

export interface RoomType {
  id: string;
  name: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
}

export const ZONE_KIND_LABEL: Record<ZoneKind, string> = {
  building: 'Корпус',
  parking: 'Паркинг',
  stylobate: 'Стилобат',
  section: 'Секция',
  roof: 'Кровля',
  other: 'Прочее',
  techfloor: 'Техэтаж',
  street: 'Улица',
};

// Иконка и акцентный цвет яруса — единый источник для разреза-конструктора и тегов локации в смете.
export const ZONE_KIND_ICON: Record<ZoneKind, ComponentType> = {
  building: BankOutlined,
  parking: CarOutlined,
  stylobate: BuildOutlined,
  section: ApartmentOutlined,
  roof: BorderTopOutlined,
  other: EnvironmentOutlined,
  techfloor: ToolOutlined,
  street: GlobalOutlined,
};

export const ZONE_KIND_COLOR: Record<ZoneKind, string> = {
  building: '#1677ff',
  parking: '#722ed1',
  stylobate: '#fa8c16',
  section: '#4096ff',
  roof: '#595959',
  other: '#8c8c8c',
  techfloor: '#13a8a8',
  street: '#52c41a',
};

// ---------- Конструктор локаций: базовые слои, маппинг этажей, порядок ----------

// Базовый вес sort_order слоя (снизу вверх). Повторяемые (корпус/кровля) сдвигаются по индексу.
export const LAYER_BASE_ORDER: Record<ZoneKind, number> = {
  street: 5,
  parking: 10,
  techfloor: 20,
  stylobate: 30,
  building: 40,
  section: 40,
  roof: 900,
  other: 950,
};

export interface BaseLayerPreset {
  kind: ZoneKind;
  label: string;            // подпись кнопки в палитре
  repeatable: boolean;      // корпус/кровля — можно несколько; остальные — единичные
  defaultName: string;
  defaultFloorMin: number | null;
  defaultFloorMax: number | null;
}

// Палитра «Добавить». Все повторяемы: корпусов, паркингов, стилобатов и техэтажей может быть несколько.
// Кровля убрана (будет в типах помещений); «Улица» добавляется автоматически (не через палитру).
export const BASE_LAYER_PRESETS: BaseLayerPreset[] = [
  { kind: 'building',  label: 'Корпус',   repeatable: true, defaultName: 'Корпус',   defaultFloorMin: 1, defaultFloorMax: 1 },
  { kind: 'parking',   label: 'Паркинг',  repeatable: true, defaultName: 'Паркинг',  defaultFloorMin: -1, defaultFloorMax: -1 },
  { kind: 'stylobate', label: 'Стилобат', repeatable: true, defaultName: 'Стилобат', defaultFloorMin: 1, defaultFloorMax: 2 },
  { kind: 'techfloor', label: 'Техэтаж',  repeatable: true, defaultName: 'Техэтаж',  defaultFloorMin: 1, defaultFloorMax: 1 },
];

// «Количество этажей» ↔ диапазон. Паркинг считает подземные (отрицательные), остальные — надземные с 1.
export function floorCountToRange(kind: ZoneKind, count: number): { floorMin: number; floorMax: number } {
  const n = Math.max(1, Math.round(count));
  if (kind === 'parking') return { floorMin: -n, floorMax: -1 };
  return { floorMin: 1, floorMax: n };
}

export function rangeToFloorCount(floorMin: number | null, floorMax: number | null): number {
  if (floorMin == null || floorMax == null) return 0;
  return floorMax - floorMin + 1;
}

// «эт. 5–40» | «эт. 5» | '' (диапазон этажей).
export function formatFloorRange(from: number | null | undefined, to: number | null | undefined): string {
  if (from == null && to == null) return '';
  if (from != null && to != null) return from === to ? `эт. ${from}` : `эт. ${from}–${to}`;
  const v = from ?? to;
  return `эт. ${v}`;
}

// Компактная подпись локации строки из денормализованных полей выдачи.
// Типы помещений временно скрыты во всём локационном UX — room_type_name не выводим
// (поле в сигнатуре оставлено опциональным, чтобы не ломать вызовы).
export function formatLocationLabel(item: {
  zone_name?: string | null;
  floor_from?: number | null;
  floor_to?: number | null;
  room_type_name?: string | null;
}): string {
  const parts: string[] = [];
  if (item.zone_name) parts.push(item.zone_name);
  const fr = formatFloorRange(item.floor_from, item.floor_to);
  if (fr) parts.push(fr);
  return parts.join(' · ');
}

// Есть ли у строки хоть одна координата локации (тип помещения временно не учитываем).
// Источник истины — locations; legacy-поля как фолбэк.
export function hasLocation(item: {
  locations?: LocationEntry[] | null;
  zone_id?: string | null;
  floor_from?: number | null;
  floor_to?: number | null;
  room_type_id?: string | null;
}): boolean {
  if (item.locations && item.locations.length > 0) return true;
  return !!(item.zone_id || item.floor_from != null || item.floor_to != null);
}

// Плоский список всех зон дерева (для поиска/выбора).
export function flattenZones(roots: ZoneNode[]): ZoneNode[] {
  const out: ZoneNode[] = [];
  const walk = (nodes: ZoneNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

export function findZone(roots: ZoneNode[], id: string | null | undefined): ZoneNode | undefined {
  if (!id) return undefined;
  return flattenZones(roots).find((z) => z.id === id);
}

// Диапазон доступных этажей зоны как массив (для выбора «вручную»).
export function zoneFloors(zone: ZoneNode | undefined): number[] {
  if (!zone || zone.floor_min == null || zone.floor_max == null) return [];
  const out: number[] = [];
  for (let f = zone.floor_min; f <= zone.floor_max; f++) out.push(f);
  return out;
}

// ---------- Мультилокация строки: зоны + точный набор этажей ----------

// Элемент локации работы: одна зона + точный набор этажей (floors: [] = «весь корпус»).
export interface LocationEntry {
  zoneId: string | null;
  floors: number[];
}

// Разобрать строку этажей в точный набор. Списки через запятую, диапазоны через тире,
// поддержка минусов: «1-4, 6» → [1,2,3,4,6]; «-1-8» → [-1,1,…,8]; «-3--1» → [-3,-2,-1].
// Этаж 0 внутри диапазона пропускаем (в зданиях его нет). Нераспознанные токены игнорируются.
export function parseFloors(input: string): number[] {
  const set = new Set<number>();
  for (const raw of input.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const range = token.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (range) {
      let a = parseInt(range[1]!, 10);
      let b = parseInt(range[2]!, 10);
      if (a > b) [a, b] = [b, a];
      for (let f = a; f <= b; f++) {
        if (f !== 0) set.add(f); // нет этажа 0
      }
      continue;
    }
    if (/^-?\d+$/.test(token)) set.add(parseInt(token, 10));
  }
  return [...set].sort((x, y) => x - y);
}

// Полностью ли строку этажей можно разобрать. Пусто = валидно (= все этажи).
export function isValidFloorsInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return true;
  return trimmed.split(',').every((raw) => {
    const t = raw.trim();
    if (!t) return false;
    return /^-?\d+$/.test(t) || /^-?\d+\s*-\s*-?\d+$/.test(t);
  });
}

// Свернуть набор этажей в каноничную строку: «-1-4, 6» (подряд идущие → диапазон).
// Смежность учитывает пропуск нуля: после −1 идёт 1.
export function formatFloors(floors: number[]): string {
  const uniq = [...new Set(floors)].sort((a, b) => a - b);
  if (uniq.length === 0) return '';
  const parts: string[] = [];
  const flush = (a: number, b: number) => parts.push(a === b ? `${a}` : `${a}-${b}`);
  let start = uniq[0]!;
  let prev = uniq[0]!;
  for (let k = 1; k < uniq.length; k++) {
    const cur = uniq[k]!;
    const expected = prev === -1 ? 1 : prev + 1;
    if (cur === expected) { prev = cur; continue; }
    flush(start, prev);
    start = cur;
    prev = cur;
  }
  flush(start, prev);
  return parts.join(', ');
}

// Число «ячеек» (зона × этаж) для равномерного распределения объёма.
// Явные этажи — как есть; пустые («весь корпус») — по диапазону зоны floor_min..floor_max;
// если диапазона нет — считаем 1 ячейкой (zone-level).
export function countLocationCells(
  locations: LocationEntry[] | null | undefined,
  roots: ZoneNode[],
): number {
  if (!locations || locations.length === 0) return 0;
  let cells = 0;
  for (const loc of locations) {
    if (loc.floors && loc.floors.length > 0) {
      cells += loc.floors.length;
      continue;
    }
    const span = rangeToFloorCount(findZone(roots, loc.zoneId)?.floor_min ?? null, findZone(roots, loc.zoneId)?.floor_max ?? null);
    cells += span > 0 ? span : 1;
  }
  return cells;
}

// Доля объёма на одну ячейку «зона×этаж» при равномерном распределении (0, если нет ячеек/объёма).
export function distributePerCell(
  locations: LocationEntry[] | null | undefined,
  quantity: number,
  roots: ZoneNode[],
): number {
  const cells = countLocationCells(locations, roots);
  if (cells <= 0 || !(quantity > 0)) return 0;
  return quantity / cells;
}

// Подпись мультилокации строки: «Корпус 1, Корпус 2 · эт. -1-4, 6». Имена зон — из дерева.
export function formatLocationsLabel(
  locations: LocationEntry[] | null | undefined,
  roots: ZoneNode[],
): string {
  if (!locations || locations.length === 0) return '';
  const zoneNames = [
    ...new Set(
      locations
        .map((l) => (l.zoneId ? findZone(roots, l.zoneId)?.name ?? null : null))
        .filter((n): n is string => !!n),
    ),
  ];
  const floors = locations.flatMap((l) => l.floors ?? []);
  const parts: string[] = [];
  if (zoneNames.length) parts.push(zoneNames.join(', '));
  const fr = formatFloors(floors);
  if (fr) parts.push(`эт. ${fr}`);
  return parts.join(' · ');
}
