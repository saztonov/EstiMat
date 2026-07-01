import type { Pool } from 'pg';
import { gatherExportData, ExportError, type ExportItemRef } from './data.js';
import { exportKpWorkbook } from './writer.js';

export { ExportError };
export type { ExportItemRef };

/**
 * Экспорт сметы в Excel-шаблон «КП»: собрать данные по видимым (отфильтрованным на клиенте)
 * работам, сгруппировать по локации и заполнить шаблон. Возвращает готовый .xlsx (Buffer).
 */
export async function exportEstimateKp(
  pool: Pool,
  estimateId: string,
  refs: ExportItemRef[],
): Promise<Buffer> {
  const blocks = await gatherExportData(pool, estimateId, refs);
  return exportKpWorkbook(blocks);
}
