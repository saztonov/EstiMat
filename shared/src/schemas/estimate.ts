import { z } from 'zod';

export const createEstimateSchema = z.object({
  projectId: z.string().uuid(),
  costCategoryId: z.string().uuid().nullable().optional(),
  workType: z.string().optional(),
  notes: z.string().optional(),
});

export const updateEstimateSchema = z.object({
  costCategoryId: z.string().uuid().nullable().optional(),
  workType: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// === Работы (строки сметы) ===
// Строка работы несёт вид затрат (cost_type_id); объект и категория проставляются
// триггером БД из сметы и вида затрат.
// Поля трассировки источника позиции (общие для работ и материалов).
// source: 'manual' — добавлено вручную, 'ai' — ИИ-агентом из РД, 'catalog' — из справочника.
export const sourceTraceSchema = z.object({
  source: z.enum(['manual', 'ai', 'catalog']).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  needsReview: z.boolean().optional(),
  sourceDocId: z.string().nullable().optional(),
  sourceSnippet: z.string().nullable().optional(),
});

export const createEstimateItemSchema = z.object({
  costTypeId: z.string().uuid().nullable().optional(),
  rateId: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Описание обязательно'),
  quantity: z.number().positive('Количество должно быть положительным'),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  sortOrder: z.number().int().default(0),
}).merge(sourceTraceSchema);

export const updateEstimateItemSchema = createEstimateItemSchema.partial();

// === Материалы (привязаны к строке работы) ===
// status: 'suggested' — материал добавлен автоматически по типовому набору расценки
// («предложение», требует подтверждения ✓ или удаления ✗), 'confirmed' — подтверждён.
export const estimateMaterialStatusSchema = z.enum(['suggested', 'confirmed']);

export const createEstimateMaterialSchema = z.object({
  materialId: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Описание обязательно'),
  quantity: z.number().positive('Количество должно быть положительным'),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  sortOrder: z.number().int().default(0),
  status: estimateMaterialStatusSchema.default('confirmed'),
}).merge(sourceTraceSchema);

export const updateEstimateMaterialSchema = createEstimateMaterialSchema.partial();

// === Подрядчик на вид затрат (estimate + cost_type) ===
export const setEstimateContractorSchema = z.object({
  costTypeId: z.string().uuid(),
  contractorId: z.string().uuid(),
});

export const estimateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  costCategoryId: z.string().uuid().nullable(),
  workType: z.string().nullable(),
  totalAmount: z.string(),
  createdBy: z.string().uuid(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;
export type SourceTrace = z.infer<typeof sourceTraceSchema>;
export type CreateEstimateItemInput = z.infer<typeof createEstimateItemSchema>;
export type UpdateEstimateItemInput = z.infer<typeof updateEstimateItemSchema>;
export type CreateEstimateMaterialInput = z.infer<typeof createEstimateMaterialSchema>;
export type UpdateEstimateMaterialInput = z.infer<typeof updateEstimateMaterialSchema>;
export type EstimateMaterialStatus = z.infer<typeof estimateMaterialStatusSchema>;
export type SetEstimateContractorInput = z.infer<typeof setEstimateContractorSchema>;
export type Estimate = z.infer<typeof estimateSchema>;
