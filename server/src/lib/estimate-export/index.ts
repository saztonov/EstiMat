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
 * работам, сгруппировать по локации, заполнить лист «КП» и листы-справочники МАТЕРИАЛЫ/РАБОТЫ
 * (уникальные материалы/работы), подставить в шапку название и адрес объекта из справочника
 * «Проекты». При конфликте единиц измерения у одинаковых наименований бросает
 * ExportUnitConflictError — если только клиент явно не разрешил пропуск (ignoreUnitConflicts).
 * Возвращает готовый .xlsx (Buffer).
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
  // Название и адрес объекта — для шапки «КП» (C5/C6).
  const { rows: projectRows } = await pool.query(
    `SELECT p.name, p.address FROM estimates e JOIN projects p ON e.project_id = p.id WHERE e.id = $1`,
    [estimateId],
  );
  const project = {
    name: (projectRows[0]?.name as string | null) ?? null,
    address: (projectRows[0]?.address as string | null) ?? null,
  };
  return exportKpWorkbook(blocks, { materials: ref.materials, works: ref.works }, project);
}
