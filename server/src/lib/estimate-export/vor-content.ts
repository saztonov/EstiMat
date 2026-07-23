// Каноническое содержимое строки ВОР: снимок значений, хэш и diff.
//
// Быстрый статус «строка изменилась после выгрузки» определяется сравнением построчного
// SHA-256 (content_hash в estimate_vor_items) с хэшем текущего состояния. Точный diff
// «было → стало» строится по снимку значений (manifest в S3) относительно текущего.
//
// В хэш входит РОВНО то, что видно в файле ВОР (наименование, ед., объём, тип отделки,
// структурная локация, примечания, состав материалов с повторениями). НЕ входят: UUID
// материалов, порядок материалов (детерминированная сортировка), цены, служебные поля.
// locationLabel хранится в снимке только для показа — в хэш не входит (в него идёт
// структурное поле locations).

import { createHash } from 'node:crypto';

/** Версия формулы хэша + схемы снимка. Bump при изменении канона (старые ВОР не «краснеют»:
 *  для них хэш пересчитывается их же версией — канонизатор каждой версии сохраняется).
 *  v2 добавил состав работы из справочника (он печатается в колонке «Примечание» файла). */
export const VOR_CONTENT_SCHEMA_VERSION = 2;

export interface VorItemLocation {
  zoneId: string | null;
  floors: number[];
}

export interface VorMaterialSnapshot {
  /** em.id — для сопоставления в diff; в хэш НЕ входит. */
  materialId: string;
  name: string;
  unit: string | null;
  volume: number | null;
  coef: number | null;
}

export interface VorItemSnapshot {
  itemId: string;
  name: string;
  unit: string | null;
  volume: number | null;
  typeName: string | null;
  locations: VorItemLocation[];
  /** Человекочитаемая метка локации (как её видел файл) — только для показа. */
  locationLabel: string;
  notes: string | null;
  /** Состав работы из справочника (rates.description) на момент выгрузки. Печатается в колонке
   *  «Примечание» следом за комментариями. В хэш входит только со схемы v2: снимки v1 его не
   *  содержат, и канонизатор v1 его игнорирует — старые ВОР от появления состава не «краснеют». */
  composition?: string | null;
  /** В файловом порядке (для показа); хэш сортирует их канонически. */
  materials: VorMaterialSnapshot[];
}

export interface VorManifest {
  schemaVersion: number;
  items: VorItemSnapshot[];
}

/** pg отдаёт NUMERIC строкой — нормализуем как при сборке файла (Number), иначе '1.50'≠'1.5'. */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Нормализовать estimate_items.locations ([{zoneId, floors[]}]) детерминированно. */
export function normalizeLocations(raw: unknown): VorItemLocation[] {
  if (!Array.isArray(raw)) return [];
  const out: VorItemLocation[] = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object') continue;
    const rec = l as { zoneId?: unknown; floors?: unknown };
    const zoneId = rec.zoneId === null || rec.zoneId === undefined ? null : String(rec.zoneId);
    const floors = (Array.isArray(rec.floors) ? rec.floors : [])
      .map((f) => Number(f))
      .filter((f) => Number.isFinite(f))
      .sort((a, b) => a - b);
    out.push({ zoneId, floors });
  }
  out.sort((a, b) => (a.zoneId ?? '').localeCompare(b.zoneId ?? ''));
  return out;
}

// ── Канонизация и хэш ────────────────────────────────────────────────────────

// Канонический порядок материалов — общий для всех версий.
function canonicalMaterials(it: VorItemSnapshot) {
  return it.materials
    .map((m) => ({ n: m.name, u: m.unit, q: m.volume, c: m.coef }))
    .sort(
      (a, b) =>
        a.n.localeCompare(b.n) ||
        (a.u ?? '').localeCompare(b.u ?? '') ||
        (a.q ?? 0) - (b.q ?? 0) ||
        (a.c ?? 0) - (b.c ?? 0),
    );
}

// v1 — БЕЗ состава работы. Менять эту функцию нельзя: по ней пересчитываются хэши всех ВОР,
// выгруженных до появления состава, и любая правка «покрасит» их разом.
function canonicalV1(it: VorItemSnapshot): string {
  return JSON.stringify({
    n: it.name,
    u: it.unit,
    q: it.volume,
    t: it.typeName,
    l: it.locations,
    x: it.notes,
    m: canonicalMaterials(it),
  });
}

// v2 — то же плюс состав работы (ключ 'c'): он попадает в файл, значит правка состава в
// справочнике делает ранее выгруженный ВОР неактуальным. Пусто и отсутствие эквивалентны.
function canonicalV2(it: VorItemSnapshot): string {
  return JSON.stringify({
    n: it.name,
    u: it.unit,
    q: it.volume,
    t: it.typeName,
    l: it.locations,
    x: it.notes,
    c: it.composition ?? null,
    m: canonicalMaterials(it),
  });
}

const CANONICALIZERS: Record<number, (it: VorItemSnapshot) => string> = {
  1: canonicalV1,
  2: canonicalV2,
};

/** Поддерживается ли версия схемы текущим кодом (иначе статус ВОР — «unknown»). */
export function isSupportedSchemaVersion(v: number): boolean {
  return v >= 1 && v in CANONICALIZERS;
}

/** SHA-256 (32 байта) канонического содержимого строки версией `version`. */
export function contentHash(it: VorItemSnapshot, version: number = VOR_CONTENT_SCHEMA_VERSION): Buffer {
  const canon = CANONICALIZERS[version];
  if (!canon) throw new Error(`Unsupported VOR content schema version: ${version}`);
  return createHash('sha256').update(canon(it)).digest();
}

// ── Diff «было → стало» ──────────────────────────────────────────────────────

export interface VorFieldChange {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
}
export interface VorMaterialChange {
  kind: 'added' | 'removed' | 'changed';
  name: string;
  fields?: VorFieldChange[];
}
export type VorItemDiffState = 'unchanged' | 'changed' | 'deleted';
export interface VorItemDiff {
  itemId: string;
  name: string;
  state: VorItemDiffState;
  fields: VorFieldChange[];
  materials: VorMaterialChange[];
}

const fmtNum = (v: number | null): string | null => (v === null ? null : String(v));
const matContentKey = (m: VorMaterialSnapshot): string => JSON.stringify([m.name, m.unit, m.volume, m.coef]);

function matFieldChanges(b: VorMaterialSnapshot, a: VorMaterialSnapshot): VorFieldChange[] {
  const out: VorFieldChange[] = [];
  const push = (key: string, label: string, bv: string | null, av: string | null) => {
    if (bv !== av) out.push({ key, label, before: bv, after: av });
  };
  push('name', 'наименование', b.name || null, a.name || null);
  push('unit', 'ед.', b.unit, a.unit);
  push('volume', 'кол-во', fmtNum(b.volume), fmtNum(a.volume));
  push('coef', 'расход', fmtNum(b.coef), fmtNum(a.coef));
  return out;
}

/** Сопоставление материалов, согласованное с хэшем: сперва снимаем идентичные по содержимому
 *  пары (мультимножество) — чистая перестановка/пересоздание = ничего; остаток сопоставляем
 *  по ключу (UUID → имя) как changed; финальный остаток — removed/added. */
function diffMaterials(before: VorMaterialSnapshot[], after: VorMaterialSnapshot[]): VorMaterialChange[] {
  const afterPool = [...after];
  const beforeRest: VorMaterialSnapshot[] = [];
  for (const b of before) {
    const idx = afterPool.findIndex((a) => matContentKey(a) === matContentKey(b));
    if (idx >= 0) afterPool.splice(idx, 1);
    else beforeRest.push(b);
  }
  const afterRest = [...afterPool];
  const changes: VorMaterialChange[] = [];
  const matchBy = (keyOf: (m: VorMaterialSnapshot) => string | null) => {
    for (let i = beforeRest.length - 1; i >= 0; i--) {
      const b = beforeRest[i]!;
      const bk = keyOf(b);
      if (bk == null) continue;
      const j = afterRest.findIndex((a) => keyOf(a) === bk);
      if (j >= 0) {
        const a = afterRest[j]!;
        changes.push({ kind: 'changed', name: a.name || b.name, fields: matFieldChanges(b, a) });
        beforeRest.splice(i, 1);
        afterRest.splice(j, 1);
      }
    }
  };
  matchBy((m) => m.materialId || null);
  matchBy((m) => m.name || null);
  for (const b of beforeRest) changes.push({ kind: 'removed', name: b.name });
  for (const a of afterRest) changes.push({ kind: 'added', name: a.name });
  return changes;
}

/** Компактная запись этажей: [1,2,3,4,6] → «1-4,6». */
function compactFloors(floors: number[]): string {
  if (!floors.length) return '';
  const s = [...floors].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = s[0]!;
  let prev = s[0]!;
  for (let i = 1; i <= s.length; i++) {
    const cur = s[i];
    if (i < s.length && cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (i < s.length && cur !== undefined) {
      start = cur;
      prev = cur;
    }
  }
  return parts.join(',');
}

/** Человекочитаемая метка локации из структуры (для показа обеих сторон diff единым форматом). */
export function formatVorLocations(locs: VorItemLocation[], zoneNameById: Map<string, string>): string {
  if (!locs.length) return '';
  return locs
    .map((l) => {
      const zone = l.zoneId ? zoneNameById.get(l.zoneId) ?? '—' : 'Без зоны';
      const floors = compactFloors(l.floors);
      return floors ? `${zone}: эт. ${floors}` : zone;
    })
    .join('; ');
}

/** diff одной работы: снимок в ВОР (before) против текущего состояния (after; null = удалена).
 *  `version` — схема содержимого этого ВОР: состав работы сравниваем только с v2, иначе снимок
 *  v1 (в котором состава нет) давал бы ложное «состав добавлен» у каждой работы. */
export function diffItem(
  before: VorItemSnapshot,
  after: VorItemSnapshot | null,
  version: number = VOR_CONTENT_SCHEMA_VERSION,
): VorItemDiff {
  if (!after) return { itemId: before.itemId, name: before.name, state: 'deleted', fields: [], materials: [] };
  const fields: VorFieldChange[] = [];
  const push = (key: string, label: string, bv: string | null, av: string | null) => {
    if (bv !== av) fields.push({ key, label, before: bv, after: av });
  };
  push('name', 'наименование', before.name || null, after.name || null);
  push('unit', 'ед.', before.unit, after.unit);
  push('volume', 'кол-во', fmtNum(before.volume), fmtNum(after.volume));
  push('typeName', 'тип отделки', before.typeName, after.typeName);
  if (JSON.stringify(before.locations) !== JSON.stringify(after.locations)) {
    fields.push({
      key: 'locations',
      label: 'местоположение',
      before: before.locationLabel || null,
      after: after.locationLabel || null,
    });
  }
  push('notes', 'примечания', before.notes, after.notes);
  if (version >= 2) {
    push('composition', 'состав работы', before.composition ?? null, after.composition ?? null);
  }
  const materials = diffMaterials(before.materials, after.materials);
  const state: VorItemDiffState = fields.length > 0 || materials.length > 0 ? 'changed' : 'unchanged';
  return { itemId: after.itemId, name: after.name, state, fields, materials };
}
