import type { Pool } from 'pg';
import {
  gatherExportModel,
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
import { VOR_CONTENT_SCHEMA_VERSION, type VorManifest } from './vor-content.js';

export { ExportError, ExportUnitConflictError };
export type { ExportItemRef, ExportRefRow, ExportConflict };

/** Результат экспорта ВОР: файл + построчный снимок (manifest) + хэши содержимого работ. */
export interface VorExportResult {
  buffer: Buffer;
  manifest: VorManifest;
  hashByItem: Map<string, Buffer>;
}

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
): Promise<VorExportResult> {
  const { blocks, items, hashByItem } = await gatherExportModel(pool, estimateId, refs);
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
  // Шифры РД (C7): уникальные коды шифров видов работ, попавших в выгрузку. Обязательное
  // ei.estimate_id = $1 — защита от чужих item ID; пустой набор оставит C7 пустой.
  const itemIds = refs.map((r) => r.id);
  const { rows: cipherRows } = await pool.query(
    `SELECT DISTINCT c.code
       FROM estimate_items ei
       JOIN estimate_cost_type_ciphers ectc
         ON ectc.estimate_id = ei.estimate_id AND ectc.cost_type_id = ei.cost_type_id
       JOIN project_rd_ciphers c ON c.id = ectc.cipher_id
      WHERE ei.estimate_id = $1 AND ei.id = ANY($2::uuid[])
      ORDER BY c.code`,
    [estimateId, itemIds],
  );
  const ciphers = cipherRows.map((r) => r.code as string).join(', ') || null;
  const project = {
    name: (projectRows[0]?.name as string | null) ?? null,
    address: (projectRows[0]?.address as string | null) ?? null,
    ciphers,
  };
  const buffer = await exportKpWorkbook(blocks, { materials: ref.materials, works: ref.works }, project);
  return { buffer, manifest: { schemaVersion: VOR_CONTENT_SCHEMA_VERSION, items }, hashByItem };
}
