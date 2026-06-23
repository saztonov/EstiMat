// Типы и утилиты локализации для клиента (зоны объекта + типы помещений).

export type ZoneKind = 'building' | 'parking' | 'stylobate' | 'section' | 'roof' | 'other';

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
  parking: 'Парковка',
  stylobate: 'Стилобат',
  section: 'Секция',
  roof: 'Кровля',
  other: 'Прочее',
};

// «эт. 5–40» | «эт. 5» | '' (диапазон этажей).
export function formatFloorRange(from: number | null | undefined, to: number | null | undefined): string {
  if (from == null && to == null) return '';
  if (from != null && to != null) return from === to ? `эт. ${from}` : `эт. ${from}–${to}`;
  const v = from ?? to;
  return `эт. ${v}`;
}

// Компактная подпись локации строки из денормализованных полей выдачи.
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
  if (item.room_type_name) parts.push(item.room_type_name);
  return parts.join(' · ');
}

// Есть ли у строки хоть одна координата локации.
export function hasLocation(item: {
  zone_id?: string | null;
  floor_from?: number | null;
  floor_to?: number | null;
  room_type_id?: string | null;
}): boolean {
  return !!(item.zone_id || item.room_type_id || item.floor_from != null || item.floor_to != null);
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
