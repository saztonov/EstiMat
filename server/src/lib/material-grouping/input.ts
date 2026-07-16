/**
 * Канонический вход для группировки — собирается ТОЛЬКО из БД.
 *
 * Клиент присылает смету; названия, количества и контексты сервер читает сам. Иначе содержимое
 * запроса к модели было бы управляемым из браузера, а вход мог бы разъехаться с тем, что реально
 * лежит в смете.
 *
 * Вход — всегда ПОЛНЫЙ объём сметы, без масштабирования по долям подрядчиков: результат один на
 * смету и одинаков для всех. Отбор под конкретного подрядчика — это проекция готового результата
 * (project.ts), а не отдельный расчёт.
 */
import { createHash } from 'node:crypto';
import { aggKey, lineKey, type GroupingSettings } from '@estimat/shared';
import type { Pool } from 'pg';
import type { GroupingLine } from './types.js';

interface RawRow {
  cost_type_id: string | null;
  cost_type_name: string | null;
  cost_category_id: string | null;
  cost_category_name: string | null;
  material_id: string | null;
  name: string;
  unit: string;
  quantity: string;
  material_group_name: string | null;
  work_id: string;
  work_name: string;
  locations: unknown;
  zone_id: string | null;
  floor_from: number | null;
  floor_to: number | null;
  location_type_id: string | null;
  location_type_name: string | null;
  zone_name: string | null;
}

// Геометрическая сигнатура работы: тот же принцип, что в клиентском locationKey, но без типа —
// тип живёт отдельным измерением. Ключ на работу целиком, поэтому этажи не размножают строку.
function geoSig(r: RawRow): string {
  const locs = Array.isArray(r.locations) ? (r.locations as { zoneId?: string | null; floors?: number[] }[]) : [];
  if (locs.length > 0) {
    return locs
      .map((l) => `${l.zoneId ?? ''}:${[...new Set(l.floors ?? [])].sort((a, b) => a - b).join(',')}`)
      .sort()
      .join(';');
  }
  return `legacy:${r.zone_id ?? ''}:${r.floor_from ?? ''}-${r.floor_to ?? ''}`;
}

function locationLabel(r: RawRow): string {
  const locs = Array.isArray(r.locations) ? (r.locations as { zoneId?: string | null; floors?: number[] }[]) : [];
  const floors = locs.flatMap((l) => l.floors ?? []);
  const parts = [r.zone_name ?? '', floors.length ? `эт. ${[...new Set(floors)].sort((a, b) => a - b).join(',')}` : ''];
  return parts.filter(Boolean).join(' ');
}

/**
 * Собрать строки материалов сметы, свёрнутые по ключу заказа (вид работ + материал) —
 * ровно так же, как их видит вкладка.
 */
export async function loadGroupingLines(pool: Pool, estimateId: string): Promise<GroupingLine[]> {
  const { rows } = await pool.query<RawRow>(
    `SELECT ei.cost_type_id,
            ct.name  AS cost_type_name,
            ei.cost_category_id,
            cc.name  AS cost_category_name,
            em.material_id,
            COALESCE(mc.name, em.description, 'Материал') AS name,
            em.unit,
            em.quantity::numeric AS quantity,
            mg.name  AS material_group_name,
            ei.id    AS work_id,
            ei.description AS work_name,
            ei.locations,
            ei.zone_id,
            z.name   AS zone_name,
            ei.floor_from,
            ei.floor_to,
            ei.location_type_id,
            lt.name  AS location_type_name
       FROM estimate_items ei
       JOIN estimate_materials em ON em.item_id = ei.id
       LEFT JOIN material_catalog mc ON mc.id = em.material_id
       LEFT JOIN material_groups mg  ON mg.id = mc.group_id
       LEFT JOIN cost_types ct       ON ct.id = ei.cost_type_id
       LEFT JOIN cost_categories cc  ON cc.id = ei.cost_category_id
       LEFT JOIN project_zones z     ON z.id = ei.zone_id
       LEFT JOIN project_location_types lt ON lt.id = ei.location_type_id
      WHERE ei.estimate_id = $1`,
    [estimateId],
  );

  // Свёртка по ключу заказа: строка атомарна, вхождения дают только контекст.
  const byKey = new Map<string, GroupingLine & { geo: Set<string>; types: Set<string>; works: Set<string> }>();
  for (const r of rows) {
    const key = lineKey(r.cost_type_id, aggKey(r.material_id, r.name, r.unit));
    let line = byKey.get(key);
    if (!line) {
      line = {
        orderKey: key,
        costTypeId: r.cost_type_id,
        costTypeName: r.cost_type_name,
        costCategoryId: r.cost_category_id,
        costCategoryName: r.cost_category_name,
        materialId: r.material_id,
        name: r.name,
        unit: r.unit,
        quantity: 0,
        materialGroupName: r.material_group_name,
        workNames: [],
        primaryWorkId: r.work_id,
        locationSig: '',
        typeSig: '',
        locationLabels: [],
        typeLabels: [],
        geo: new Set(),
        types: new Set(),
        works: new Set(),
      };
      byKey.set(key, line);
    }
    line.quantity += Number(r.quantity ?? 0);
    line.geo.add(geoSig(r));
    line.types.add(r.location_type_id ?? '');
    if (!line.works.has(r.work_id)) {
      line.works.add(r.work_id);
      line.workNames.push(r.work_name);
    }
    const loc = locationLabel(r);
    if (loc && !line.locationLabels.includes(loc)) line.locationLabels.push(loc);
    if (r.location_type_name && !line.typeLabels.includes(r.location_type_name)) {
      line.typeLabels.push(r.location_type_name);
    }
    // Закрепление за работой — детерминированное: наименьший work_id из вхождений.
    if (r.work_id < line.primaryWorkId) line.primaryWorkId = r.work_id;
  }

  return [...byKey.values()]
    .map(({ geo, types, works, ...line }) => {
      void works;
      return {
        ...line,
        locationSig: [...geo].sort().join(';'),
        typeSig: [...types].sort().join(';'),
      };
    })
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

/**
 * Хэш канонического входа. Меняется всё, что влияет на решение модели: состав строк,
 * количества (модель проверяет количественные соотношения), контекст, настройки, модель и
 * версия промпта. Не зависит от порядка строк — вход уже отсортирован по ключу.
 */
export function computeInputHash(
  lines: GroupingLine[],
  settings: GroupingSettings,
  qualifiedModel: string,
  promptVersion: string,
): string {
  // Сортируем здесь, а не полагаемся на порядок из loadGroupingLines: хэш обязан зависеть от
  // состава, а не от того, как вход собрали.
  const sorted = [...lines].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  const canonical = JSON.stringify({
    lines: sorted.map((l) => [
      l.orderKey,
      l.name,
      l.unit,
      // Округление до 4 знаков — та же точность, что в колонке «По смете»: плавающий хвост
      // не должен объявлять результат устаревшим.
      Math.round(l.quantity * 1e4) / 1e4,
      l.costTypeId ?? '',
      l.locationSig,
      l.typeSig,
    ]),
    settings,
    qualifiedModel,
    promptVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Эффективная версия промпта = базовая версия + полный SHA-256 от канонического JSON текстов и
 * режима рассуждений. Передаётся в computeInputHash как promptVersion, поэтому правка любого из
 * текстов промпта (system/merge) или переключение noThink инвалидируют кэш готовых результатов.
 */
export function computeEffectivePromptVersion(
  version: string,
  system: string,
  merge: string,
  noThink: boolean,
): string {
  const canonical = JSON.stringify({ version, system, merge, noThink });
  return `${version}:${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Хэш области. Область — только смета: результат общий, поэтому уникальный индекс
 * uq_mgj_active_scope (estimate_id, scope_hash) даёт ровно одно активное задание на смету.
 *
 * Значение намеренно отличается от прежнего (смета + организация + отбор): старые персональные
 * задания перестают находиться и уходят по retention, а не подмешиваются в общий результат.
 */
export function computeScopeHash(estimateId: string): string {
  return createHash('sha256').update(JSON.stringify({ estimateId })).digest('hex');
}

/**
 * Ключи заказа строк, назначенных подрядчику, — для проекции общего результата (project.ts).
 * Только ключи: количества подрядчик и так считает у себя из своего свода.
 *
 * Доля подрядчика в строке — та же формула, что в /contractors/my-items; на состав ключей она не
 * влияет (материал либо есть в его работе, либо нет), поэтому здесь важен сам факт назначения.
 */
export async function loadContractorOrderKeys(
  pool: Pool,
  estimateId: string,
  orgId: string,
): Promise<Set<string>> {
  const { rows } = await pool.query<{ cost_type_id: string | null; material_id: string | null; name: string; unit: string }>(
    `SELECT DISTINCT ei.cost_type_id,
            em.material_id,
            COALESCE(mc.name, em.description, 'Материал') AS name,
            em.unit
       FROM estimate_items ei
       JOIN estimate_item_contractors eic ON eic.item_id = ei.id AND eic.contractor_id = $2
       JOIN estimate_materials em ON em.item_id = ei.id
       LEFT JOIN material_catalog mc ON mc.id = em.material_id
      WHERE ei.estimate_id = $1`,
    [estimateId, orgId],
  );
  return new Set(rows.map((r) => lineKey(r.cost_type_id, aggKey(r.material_id, r.name, r.unit))));
}
