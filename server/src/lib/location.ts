import type { Pool, PoolClient } from 'pg';
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

// Get-or-create произвольного «типа» строки в рамках объекта (уникально по name_norm).
// Пустое имя/нет проекта → null (тип очищается). Имя триммится (в т.ч. в Zod-схеме).
export async function upsertLocationType(
  db: Pick<Pool | PoolClient, 'query'>,
  projectId: string | null,
  rawName: string | null,
): Promise<string | null> {
  const name = (rawName ?? '').trim();
  if (!projectId || !name) return null;
  const { rows } = await db.query(
    `INSERT INTO project_location_types (project_id, name, name_norm)
     VALUES ($1, $2, lower(btrim($2)))
     ON CONFLICT (project_id, name_norm) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [projectId, name],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}
