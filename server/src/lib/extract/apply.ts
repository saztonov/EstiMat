/**
 * Применение результата извлечения к смете: bulk-insert работ и материалов
 * как 'confirmed' с трассировкой источника (source='ai', ai_job_id, confidence,
 * needs_review, source_doc_id, source_snippet) и авторством (created_by/updated_by).
 *
 * Транзакцией управляет вызывающий (route/раннер) — здесь INSERT'ы + запись журнала
 * (row-level 'create' на каждую позицию + сводная 'ai_apply'). Realtime-эмит — после COMMIT
 * в вызывающем коде.
 */
import type { Queryable } from './catalog-source.js';
import type { ExtractionResult } from './types.js';
import { MATERIALS_BUCKET } from './types.js';
import { recordAuditBatch, type AuditInput } from '../audit.js';

export interface ApplyOptions {
  estimateId: string;
  projectId: string | null;
  aiJobId: string | null;
  sourceDocId: string | null;
  actorUserId: string | null;
  /** Связь сводной и row-level записей журнала + realtime-события. */
  correlationId: string;
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
  const audits: AuditInput[] = [];

  for (const work of result.works) {
    // Защитный инвариант: в смету идут только работы из справочника (rateId).
    // Единственное исключение — системный контейнер нераспределённых материалов.
    if (!work.rateId && work.description !== MATERIALS_BUCKET) continue;

    const { rows } = await db.query(
      `INSERT INTO estimate_items
         (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order,
          source, ai_job_id, confidence, needs_review, source_doc_id, source_snippet, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai', $9, $10, $11, $12, $13, $14, $14)
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
        opts.actorUserId,
      ],
    );
    const itemId = (rows[0] as { id: string }).id;
    works++;
    audits.push({
      estimateId: opts.estimateId,
      projectId: opts.projectId,
      entityType: 'estimate_item',
      entityId: itemId,
      action: 'create',
      userId: opts.actorUserId,
      correlationId: opts.correlationId,
      changes: {
        source: 'ai',
        aiJobId: opts.aiJobId,
        after: { description: work.description, quantity: work.quantity, unit: work.unit, unitPrice: work.unitPrice },
      },
    });

    let matSort = 0;
    for (const m of work.materials) {
      const ins = await db.query(
        `INSERT INTO estimate_materials
           (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status,
            source, ai_job_id, confidence, needs_review, source_doc_id, source_snippet, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'ai', $9, $10, $11, $12, $13, $14, $14)
         RETURNING id`,
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
          opts.actorUserId,
        ],
      );
      materials++;
      audits.push({
        estimateId: opts.estimateId,
        projectId: opts.projectId,
        entityType: 'estimate_material',
        entityId: (ins.rows[0] as { id: string }).id,
        action: 'create',
        userId: opts.actorUserId,
        correlationId: opts.correlationId,
        changes: {
          source: 'ai',
          aiJobId: opts.aiJobId,
          after: { description: m.description, quantity: m.quantity, unit: m.unit, unitPrice: m.unitPrice },
        },
      });
    }
  }

  // Сводная запись применения ИИ — для ленты сметы (row-level записи дают историю строк).
  audits.push({
    estimateId: opts.estimateId,
    projectId: opts.projectId,
    entityType: 'estimate',
    entityId: opts.estimateId,
    action: 'ai_apply',
    userId: opts.actorUserId,
    correlationId: opts.correlationId,
    changes: { works, materials, aiJobId: opts.aiJobId, source: 'ai' },
  });
  await recordAuditBatch(db, audits);

  return { works, materials };
}
