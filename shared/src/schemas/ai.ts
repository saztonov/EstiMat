import { z } from 'zod';

// ============================================================
// Задание ИИ-извлечения работ/материалов из РД (таблица ai_jobs)
// ============================================================

/** Источник входных данных для агента. */
export const aiJobSourceKindSchema = z.enum([
  'rd_document', // выбран документ из дерева «Рабочая документация» (sourceRef = nodeId)
  'upload_md', // загружен .md-файл (markdown во входных данных)
  'catalog_query', // текстовая задача «подбери из справочника» (query)
]);

/** Статус задания (жизненный цикл). */
export const aiJobStatusSchema = z.enum([
  'pending', // создано, ожидает запуска агента
  'running', // агент выполняется
  'ready', // результат сформирован, ещё не применён
  'applied', // позиции добавлены в смету
  'failed', // ошибка
]);

/** Откуда брать справочник при сопоставлении (настройка приложения). */
export const aiCatalogSourceSchema = z.enum(['v2_first', 'legacy', 'both']);

/**
 * Область подбора работ: разделы (cost_categories) и опционально виды (cost_types).
 * Сужает справочник расценок для ИИ-подбора и ручного добора из дерева.
 */
export const sectionScopeSchema = z.object({
  categoryIds: z.array(z.string().uuid()).default([]),
  costTypeIds: z.array(z.string().uuid()).default([]),
});

export const createAiJobSchema = z
  .object({
    estimateId: z.string().uuid(),
    sourceKind: aiJobSourceKindSchema,
    /** nodeId документа РД или имя загруженного файла. */
    sourceRef: z.string().optional(),
    /** Markdown (для upload_md). */
    markdown: z.string().optional(),
    /** Текстовая задача (для catalog_query). */
    query: z.string().optional(),
    /** Область подбора работ (разделы/виды), выбранная сметчиком. */
    sectionScope: sectionScopeSchema.optional(),
  })
  .refine(
    (v) =>
      (v.sourceKind === 'rd_document' && !!v.sourceRef) ||
      (v.sourceKind === 'upload_md' && !!v.markdown) ||
      (v.sourceKind === 'catalog_query' && !!v.query),
    { message: 'Для выбранного источника не заполнены входные данные' },
  );

// ============================================================
// Результат извлечения (ai_jobs.result, превью/трассировка)
// ============================================================

export const matchResultSchema = z.object({
  catalogId: z.string().nullable(),
  matchedName: z.string().nullable(),
  unitPrice: z.number().nullable(),
  unit: z.string().nullable(),
  costTypeId: z.string().nullable(),
  decision: z.enum(['matched', 'probable', 'unmatched']),
  via: z.enum(['exact', 'alias', 'fuzzy', 'llm', 'none']),
  confidence: z.number(),
});

export const extractedMaterialSchema = z.object({
  description: z.string(),
  materialId: z.string().nullable(),
  quantity: z.number(),
  unit: z.string(),
  unitPrice: z.number(),
  confidence: z.number(),
  needsReview: z.boolean(),
  sourceSnippet: z.string().nullable(),
  match: matchResultSchema,
});

export const extractedWorkSchema = z.object({
  description: z.string(),
  rateId: z.string().nullable(),
  costTypeId: z.string().nullable(),
  quantity: z.number(),
  unit: z.string(),
  unitPrice: z.number(),
  confidence: z.number(),
  needsReview: z.boolean(),
  sourceSnippet: z.string().nullable(),
  match: matchResultSchema,
  materials: z.array(extractedMaterialSchema),
});

export const extractionResultSchema = z.object({
  works: z.array(extractedWorkSchema),
  stats: z.object({
    blocks: z.number(),
    tables: z.number(),
    ruleItems: z.number(),
    llmItems: z.number(),
    works: z.number(),
    materials: z.number(),
    matched: z.number(),
    needsReview: z.number(),
  }),
  anomalies: z.array(z.string()),
});

export const aiJobSchema = z.object({
  id: z.string().uuid(),
  estimateId: z.string().uuid(),
  sourceKind: aiJobSourceKindSchema,
  sourceRef: z.string().nullable(),
  status: aiJobStatusSchema,
  result: extractionResultSchema.nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AiJobSourceKind = z.infer<typeof aiJobSourceKindSchema>;
export type AiJobStatus = z.infer<typeof aiJobStatusSchema>;
export type AiCatalogSource = z.infer<typeof aiCatalogSourceSchema>;
export type SectionScopeInput = z.infer<typeof sectionScopeSchema>;
export type CreateAiJobInput = z.infer<typeof createAiJobSchema>;
export type MatchResultDto = z.infer<typeof matchResultSchema>;
export type ExtractedMaterialDto = z.infer<typeof extractedMaterialSchema>;
export type ExtractedWorkDto = z.infer<typeof extractedWorkSchema>;
export type ExtractionResultDto = z.infer<typeof extractionResultSchema>;
export type AiJob = z.infer<typeof aiJobSchema>;

export interface AiJobResponse {
  data: AiJob;
}
