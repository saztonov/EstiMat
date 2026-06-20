/**
 * Применение результата извлечения к смете: bulk-insert работ и материалов
 * как 'confirmed' с трассировкой источника (source='ai', ai_job_id, confidence,
 * needs_review, source_doc_id, source_snippet).
 *
 * Транзакцией управляет вызывающий (route/раннер) — здесь только INSERT'ы.
 */
import type { Queryable } from './catalog-source.js';
import type { ExtractionResult } from './types.js';
import { MATERIALS_BUCKET } from './types.js';

export interface ApplyOptions {
  estimateId: string;
  aiJobId: string | null;
  sourceDocId: string | null;
}

export interface ApplyStats {
  works: number;
  materials: number;
}

export async function applyExtraction(
  db: Queryable,
  opts: ApplyOptions,
  result: ExtractionResult,
): Promise<ApplyStats> {
  let workSort = 0;
  let works = 0;
  let materials = 0;

  for (const work of result.works) {
    // Защитный инвариант: в смету идут только работы из справочника (rateId).
    // Единственное исключение — системный контейнер нераспределённых материалов.
    if (!work.rateId && work.description !== MATERIALS_BUCKET) continue;

    const { rows } = await db.query(
      `INSERT INTO estimate_items
         (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order,
          source, ai_job_id, confidence, needs_review, source_doc_id, source_snippet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai', $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        opts.estimateId,
        work.costTypeId,
        work.rateId,
        work.description,
        work.quantity,
        work.unit,
        work.unitPrice,
        workSort++,
        opts.aiJobId,
        work.confidence,
        work.needsReview,
        opts.sourceDocId,
        work.sourceSnippet,
      ],
    );
    const itemId = rows[0].id;
    works++;

    let matSort = 0;
    for (const m of work.materials) {
      await db.query(
        `INSERT INTO estimate_materials
           (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status,
            source, ai_job_id, confidence, needs_review, source_doc_id, source_snippet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'ai', $9, $10, $11, $12, $13)`,
        [
          itemId,
          opts.estimateId,
          m.materialId,
          m.description,
          m.quantity,
          m.unit,
          m.unitPrice,
          matSort++,
          opts.aiJobId,
          m.confidence,
          m.needsReview,
          opts.sourceDocId,
          m.sourceSnippet,
        ],
      );
      materials++;
    }
  }

  return { works, materials };
}
