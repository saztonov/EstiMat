import type { Pool } from 'pg';
import {
  gatherExportData,
  ExportError,
  ExportUnitConflictError,
  type ExportItemRef,
} from './data.js';
import {
  buildReferenceLists,
  buildUnitAliasMap,
  type ExportRefRow,
  type ExportConflict,
} from './references.js';
import { exportKpWorkbook } from './writer.js';

export { ExportError, ExportUnitConflictError };
export type { ExportItemRef, ExportRefRow, ExportConflict };

/**
 * Экспорт сметы в Excel-шаблон: собрать данные по видимым (отфильтрованным на клиенте)
 * работам, сгруппировать по локации, заполнить лист «КП» и листы-справочники БСМ/БСР
 * (уникальные материалы/работы). При конфликте единиц измерения у одинаковых наименований
 * бросает ExportUnitConflictError — если только клиент явно не разрешил пропуск
 * (ignoreUnitConflicts). Возвращает готовый .xlsx (Buffer).
 */
export async function exportEstimateKp(
  pool: Pool,
  estimateId: string,
  refs: ExportItemRef[],
  opts?: { ignoreUnitConflicts?: boolean },
): Promise<Buffer> {
  const blocks = await gatherExportData(pool, estimateId, refs);
  const { rows: unitRows } = await pool.query('SELECT name, synonyms FROM units');
  const unitAliases = buildUnitAliasMap(unitRows as { name: string; synonyms: string[] | null }[]);
  const ref = buildReferenceLists(blocks, unitAliases);
  if (ref.conflicts.length && !opts?.ignoreUnitConflicts) {
    throw new ExportUnitConflictError(ref.conflicts);
  }
  return exportKpWorkbook(blocks, { materials: ref.materials, works: ref.works });
}
