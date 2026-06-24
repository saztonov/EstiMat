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
} from '@ant-design/icons';

export type ZoneKind = 'building' | 'parking' | 'stylobate' | 'section' | 'roof' | 'other' | 'techfloor';

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
};

export const ZONE_KIND_COLOR: Record<ZoneKind, string> = {
  building: '#1677ff',
  parking: '#722ed1',
  stylobate: '#fa8c16',
  section: '#4096ff',
  roof: '#595959',
  other: '#8c8c8c',
  techfloor: '#13a8a8',
};

// ---------- Конструктор локаций: базовые слои, маппинг этажей, порядок ----------

// Базовый вес sort_order слоя (снизу вверх). Повторяемые (корпус/кровля) сдвигаются по индексу.
export const LAYER_BASE_ORDER: Record<ZoneKind, number> = {
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
export const BASE_LAYER_PRESETS: BaseLayerPreset[] = [
  { kind: 'building',  label: 'Корпус',   repeatable: true, defaultName: 'Корпус',   defaultFloorMin: 1, defaultFloorMax: 1 },
  { kind: 'parking',   label: 'Паркинг',  repeatable: true, defaultName: 'Паркинг',  defaultFloorMin: -1, defaultFloorMax: -1 },
  { kind: 'stylobate', label: 'Стилобат', repeatable: true, defaultName: 'Стилобат', defaultFloorMin: 1, defaultFloorMax: 1 },
  { kind: 'techfloor', label: 'Техэтаж',  repeatable: true, defaultName: 'Техэтаж',  defaultFloorMin: 1, defaultFloorMax: 1 },
  { kind: 'roof',      label: 'Кровля',   repeatable: true, defaultName: 'Кровля',   defaultFloorMin: null, defaultFloorMax: null },
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
export function hasLocation(item: {
  zone_id?: string | null;
  floor_from?: number | null;
  floor_to?: number | null;
  room_type_id?: string | null;
}): boolean {
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
