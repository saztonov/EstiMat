import type { CostTypeGroup, EstimateContractor, EstimateItem } from './types';
import { formatFloors } from './location';

// Группировка сметы по локации: Зона → Вид работ (CostTypeGroup).
// Мультизона: работа с несколькими зонами попадает в секцию каждой своей зоны.
// Типы помещений временно скрыты — промежуточного уровня «тип помещения» нет.
// Переиспользует CostTypeGroupBlock на нижнем уровне (вид работ).
export interface LocationSection {
  zoneKey: string;
  zoneName: string;
  groups: CostTypeGroup[];
}

const NONE = '__none__';
const GROUP_NONE = '__none__';

// Ключи зон работы (несколько при мультилокации). Фолбэк на legacy zone_id.
function zoneKeysOf(w: EstimateItem): string[] {
  const locs = w.locations ?? [];
  if (locs.length) {
    const keys = [...new Set(locs.map((l) => l.zoneId ?? NONE))];
    return keys.length ? keys : [NONE];
  }
  return [w.zone_id ?? NONE];
}

// Набор этажей работы в конкретной зоне (для подписи секции). Фолбэк на legacy диапазон.
function floorsForZone(w: EstimateItem, zoneKey: string): number[] {
  const locs = w.locations ?? [];
  if (locs.length) {
    return locs.filter((l) => (l.zoneId ?? NONE) === zoneKey).flatMap((l) => l.floors ?? []);
  }
  const out: number[] = [];
  const f = w.floor_from ?? null;
  const t = w.floor_to ?? null;
  if (f != null && t != null) { for (let x = f; x <= t; x++) out.push(x); }
  else if (f != null) out.push(f);
  else if (t != null) out.push(t);
  return out;
}

export function buildLocationGroups(
  groups: CostTypeGroup[],
  zoneNameById: Map<string, string>,
): LocationSection[] {
  // Подрядчик по виду затрат — чтобы перенести в виртуальные группы локации.
  const contractorByType = new Map<string, EstimateContractor | null>();
  for (const g of groups) if (g.costTypeId) contractorByType.set(g.costTypeId, g.contractor);

  // zoneKey → costTypeKey → CostTypeGroup
  const zoneMap = new Map<string, Map<string, CostTypeGroup>>();
  // zoneKey → набор канонических подписей этажей по работам (для подписи секции).
  const zoneFloorLabels = new Map<string, Set<string>>();

  for (const g of groups) {
    for (const w of g.works) {
      for (const zoneKey of zoneKeysOf(w)) {
        const ctKey = g.costTypeId ?? GROUP_NONE;

        const fr = formatFloors(floorsForZone(w, zoneKey));
        if (!zoneFloorLabels.has(zoneKey)) zoneFloorLabels.set(zoneKey, new Set());
        if (fr) zoneFloorLabels.get(zoneKey)!.add(fr);

        let cts = zoneMap.get(zoneKey);
        if (!cts) { cts = new Map(); zoneMap.set(zoneKey, cts); }
        let ctg = cts.get(ctKey);
        if (!ctg) {
          ctg = {
            costTypeId: g.costTypeId,
            costTypeName: g.costTypeName,
            costTypeSortOrder: g.costTypeSortOrder,
            costCategoryId: g.costCategoryId,
            costCategoryName: g.costCategoryName,
            costCategorySortOrder: g.costCategorySortOrder,
            works: [],
            contractor: g.costTypeId ? contractorByType.get(g.costTypeId) ?? null : null,
          };
          cts.set(ctKey, ctg);
        }
        ctg.works.push(w);
      }
    }
  }

  const sections: LocationSection[] = [];
  for (const [zoneKey, cts] of zoneMap) {
    const groupsArr = [...cts.values()].sort((a, b) => {
      const tr = (a.costTypeSortOrder ?? Number.MAX_SAFE_INTEGER) - (b.costTypeSortOrder ?? Number.MAX_SAFE_INTEGER);
      if (tr !== 0) return tr;
      return (a.costTypeName ?? '').localeCompare(b.costTypeName ?? '', 'ru');
    });
    const name = zoneKey === NONE ? 'Без локации' : zoneNameById.get(zoneKey) ?? 'Зона';
    // Если во всей зоне один и тот же набор этажей — покажем его в подписи.
    const labels = zoneFloorLabels.get(zoneKey);
    const zoneName = labels && labels.size === 1 ? `${name} · эт. ${[...labels][0]}` : name;
    sections.push({ zoneKey, zoneName, groups: groupsArr });
  }

  sections.sort((a, b) => {
    if (a.zoneKey === NONE) return 1;
    if (b.zoneKey === NONE) return -1;
    return a.zoneName.localeCompare(b.zoneName, 'ru');
  });
  return sections;
}
