// Построение списков-справочников МАТЕРИАЛЫ и РАБОТЫ из тех же строк, что уходят в лист
// «КП», + детект конфликтов единиц измерения.
//
// Уникальность — ПО НАИМЕНОВАНИЮ (одно наименование = одна строка). Единицы сравниваются
// по такой же нормализации; если у одного наименования встречаются РАЗНЫЕ единицы — это
// конфликт (в отличие от свода материалов aggregateMaterials, где разные единицы дают
// две строки). Порядок уникальных строк и выбранная единица — по первому появлению в
// каноническом порядке «КП». Пустая ед.изм. — отдельное значение (bucket ''), конфликтует
// с любой непустой.

import type { ExportBlock, ExportRow } from './data.js';

export interface ExportRefRow {
  name: string; //        B  наименование (как в «КП»)
  unit: string | null; // C  ед. изм. (первая встретившаяся)
}

export interface ExportConflict {
  kind: 'material' | 'work';
  name: string; //   наименование, у которого разошлись единицы
  units: string[]; // исходные различные единицы (пустая — как '')
}

// Надстрочные цифры → обычные: чтобы «м²»/«м³» не отличались от «м2»/«м3» (иначе одна
// и та же единица в разных строках даёт ложный конфликт).
const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

// Нормализация для ключа группировки: trim + схлопывание пробелов + свёртка надстрочных
// цифр + нижний регистр.
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[⁰¹²³⁴-⁹]/g, (ch) => SUPERSCRIPT[ch] ?? ch)
    .toLowerCase();
}

/**
 * Карта синонимов единиц: нормализованный вариант → нормализованное каноническое название.
 * Строится из справочника units (name + synonyms). Каноническое имя маппится само на себя.
 */
export function buildUnitAliasMap(
  units: { name: string; synonyms: string[] | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of units) {
    const canon = norm(u.name);
    if (!canon) continue;
    map.set(canon, canon);
    for (const s of u.synonyms ?? []) {
      const k = norm(s);
      if (k) map.set(k, canon);
    }
  }
  return map;
}

interface Agg {
  name: string; // первое встретившееся исходное имя (trim)
  units: Map<string, string>; // ключ единицы → первая исходная единица (в порядке появления)
}

function collect(
  rows: ExportRow[],
  kind: 'material' | 'work',
  unitAliases: Map<string, string>,
): {
  list: ExportRefRow[];
  conflicts: ExportConflict[];
} {
  const order: string[] = []; // ключи имён в порядке первого появления
  const byKey = new Map<string, Agg>();

  for (const row of rows) {
    const nameKey = norm(row.name);
    if (!nameKey) continue; // без наименования в справочник не выводим
    let agg = byKey.get(nameKey);
    if (!agg) {
      agg = { name: row.name.trim(), units: new Map() };
      byKey.set(nameKey, agg);
      order.push(nameKey);
    }
    const unitNorm = norm(row.unit);
    const unitKey = unitAliases.get(unitNorm) ?? unitNorm; // синоним → каноническая единица
    if (!agg.units.has(unitKey)) agg.units.set(unitKey, (row.unit ?? '').trim());
  }

  const list: ExportRefRow[] = [];
  const conflicts: ExportConflict[] = [];
  for (const key of order) {
    const agg = byKey.get(key)!;
    const firstUnit = agg.units.values().next().value ?? '';
    list.push({ name: agg.name, unit: firstUnit === '' ? null : firstUnit });
    if (agg.units.size >= 2) {
      conflicts.push({ kind, name: agg.name, units: [...agg.units.values()] });
    }
  }
  return { list, conflicts };
}

/**
 * Собрать уникальные списки материалов и работ + конфликты единиц из блоков экспорта.
 * unitAliases (см. buildUnitAliasMap) сводит синонимы единиц к канонической — единицы-синонимы
 * не считаются конфликтом. Без карты работает как раньше (только свёртка надстрочных цифр в norm).
 */
export function buildReferenceLists(
  blocks: ExportBlock[],
  unitAliases: Map<string, string> = new Map(),
): {
  materials: ExportRefRow[];
  works: ExportRefRow[];
  conflicts: ExportConflict[];
} {
  const allRows = blocks.flatMap((b) => b.rows);
  const materials = collect(allRows.filter((r) => r.kind === 'material'), 'material', unitAliases);
  const works = collect(allRows.filter((r) => r.kind === 'work'), 'work', unitAliases);
  return {
    materials: materials.list,
    works: works.list,
    conflicts: [...materials.conflicts, ...works.conflicts],
  };
}
