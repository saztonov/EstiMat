import type { CostTypeGroup, EstimateContractor, EstimateItem } from './types';
import { formatFloorRange } from './location';

// Группировка сметы по локации: Зона → Тип помещения → Вид работ (CostTypeGroup).
// Переиспользует CostTypeGroupBlock на нижнем уровне (вид работ).
export interface LocationRoomGroup {
  roomKey: string;
  roomName: string;
  groups: CostTypeGroup[];
}
export interface LocationSection {
  zoneKey: string;
  zoneName: string;
  rooms: LocationRoomGroup[];
}

const NONE = '__none__';
const GROUP_NONE = '__none__';

// Подпись зоны с диапазоном этажей по строкам (если в зоне один диапазон — покажем его).
function zoneLabel(works: EstimateItem[]): string {
  const name = works[0]?.zone_name;
  if (!name) return 'Без локации';
  const ranges = new Set(works.map((w) => formatFloorRange(w.floor_from, w.floor_to)).filter(Boolean));
  if (ranges.size === 1) {
    const r = [...ranges][0];
    return r ? `${name} · ${r}` : name;
  }
  return name;
}

export function buildLocationGroups(groups: CostTypeGroup[]): LocationSection[] {
  // Подрядчик по виду затрат — чтобы перенести в виртуальные группы локации.
  const contractorByType = new Map<string, EstimateContractor | null>();
  for (const g of groups) if (g.costTypeId) contractorByType.set(g.costTypeId, g.contractor);

  // zoneKey → roomKey → costTypeKey → CostTypeGroup
  const zoneMap = new Map<string, Map<string, Map<string, CostTypeGroup>>>();
  const zoneNames = new Map<string, EstimateItem[]>();

  for (const g of groups) {
    for (const w of g.works) {
      const zoneKey = w.zone_id ?? NONE;
      const roomKey = w.room_type_id ?? NONE;
      const ctKey = g.costTypeId ?? GROUP_NONE;

      if (!zoneNames.has(zoneKey)) zoneNames.set(zoneKey, []);
      zoneNames.get(zoneKey)!.push(w);

      let rooms = zoneMap.get(zoneKey);
      if (!rooms) { rooms = new Map(); zoneMap.set(zoneKey, rooms); }
      let cts = rooms.get(roomKey);
      if (!cts) { cts = new Map(); rooms.set(roomKey, cts); }
      let ctg = cts.get(ctKey);
      if (!ctg) {
        ctg = {
          costTypeId: g.costTypeId,
          costTypeName: g.costTypeName,
          costCategoryId: g.costCategoryId,
          costCategoryName: g.costCategoryName,
          works: [],
          contractor: g.costTypeId ? contractorByType.get(g.costTypeId) ?? null : null,
        };
        cts.set(ctKey, ctg);
      }
      ctg.works.push(w);
    }
  }

  const roomNameOf = (works: EstimateItem[]) => works[0]?.room_type_name ?? 'Без типа помещения';

  const sections: LocationSection[] = [];
  for (const [zoneKey, rooms] of zoneMap) {
    const zoneWorks = zoneNames.get(zoneKey) ?? [];
    const roomGroups: LocationRoomGroup[] = [];
    for (const [roomKey, cts] of rooms) {
      const groupsArr = [...cts.values()].sort((a, b) =>
        (a.costTypeName ?? '').localeCompare(b.costTypeName ?? '', 'ru'));
      const roomWorks = groupsArr.flatMap((g) => g.works);
      roomGroups.push({
        roomKey,
        roomName: roomKey === NONE ? 'Без типа помещения' : roomNameOf(roomWorks),
        groups: groupsArr,
      });
    }
    roomGroups.sort((a, b) => {
      if (a.roomKey === NONE) return 1;
      if (b.roomKey === NONE) return -1;
      return a.roomName.localeCompare(b.roomName, 'ru');
    });
    sections.push({ zoneKey, zoneName: zoneLabel(zoneWorks), rooms: roomGroups });
  }

  sections.sort((a, b) => {
    if (a.zoneKey === NONE) return 1;
    if (b.zoneKey === NONE) return -1;
    return a.zoneName.localeCompare(b.zoneName, 'ru');
  });
  return sections;
}
