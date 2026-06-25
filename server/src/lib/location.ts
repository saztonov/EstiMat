import type { LocationEntry } from '@estimat/shared';

// ---------- Мультилокация: производное «первичное» зеркало legacy-колонок ----------

// Развернуть диапазон floor_from..floor_to в точный набор этажей (для зеркала ↔ jsonb).
export function expandFloors(from: number | null, to: number | null): number[] {
  if (from == null && to == null) return [];
  if (from != null && to != null) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const out: number[] = [];
    for (let f = lo; f <= hi; f++) out.push(f);
    return out;
  }
  return [(from ?? to) as number];
}

// Собрать массив локаций из легаси-полей (старый клиент без locations, тиражирование).
export function legacyToLocations(
  zoneId: string | null,
  floorFrom: number | null,
  floorTo: number | null,
): LocationEntry[] {
  if (zoneId == null && floorFrom == null && floorTo == null) return [];
  return [{ zoneId, floors: expandFloors(floorFrom, floorTo) }];
}

// Производное «первичное» зеркало (первая зона; min/max объединённого набора этажей).
export function deriveLegacyLocation(locations: LocationEntry[]): {
  zoneId: string | null;
  floorFrom: number | null;
  floorTo: number | null;
} {
  const zoneId = locations.find((l) => l.zoneId != null)?.zoneId ?? null;
  const floors = locations.flatMap((l) => l.floors ?? []);
  if (floors.length === 0) return { zoneId, floorFrom: null, floorTo: null };
  return { zoneId, floorFrom: Math.min(...floors), floorTo: Math.max(...floors) };
}
