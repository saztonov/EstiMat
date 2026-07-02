// Построение списков-справочников БСМ (материалы) и БСР (работы) из тех же строк, что
// уходят в лист «КП», + детект конфликтов единиц измерения.
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

// Нормализация для ключа группировки: trim + схлопывание пробелов + нижний регистр.
function norm(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

interface Agg {
  name: string; // первое встретившееся исходное имя (trim)
  units: Map<string, string>; // ключ единицы → первая исходная единица (в порядке появления)
}

function collect(rows: ExportRow[], kind: 'material' | 'work'): {
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
    const unitKey = norm(row.unit);
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
 */
export function buildReferenceLists(blocks: ExportBlock[]): {
  materials: ExportRefRow[];
  works: ExportRefRow[];
  conflicts: ExportConflict[];
} {
  const allRows = blocks.flatMap((b) => b.rows);
  const materials = collect(allRows.filter((r) => r.kind === 'material'), 'material');
  const works = collect(allRows.filter((r) => r.kind === 'work'), 'work');
  return {
    materials: materials.list,
    works: works.list,
    conflicts: [...materials.conflicts, ...works.conflicts],
  };
}
