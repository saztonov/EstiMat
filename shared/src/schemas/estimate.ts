import { z } from 'zod';
import { locationContextSchema, locationEntrySchema } from './location.js';

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
}).merge(sourceTraceSchema).merge(locationContextSchema);

// OCC: клиент передаёт version строки, снятый при открытии формы редактирования.
// Сервер сверяет его с актуальным и при расхождении отвечает 409 (см. routes).
// optional — обратная совместимость со старым клиентом и confirm/needsReview-вызовами.
const occSchema = z.object({ expectedVersion: z.number().int().optional() });

export const updateEstimateItemSchema = createEstimateItemSchema.partial().merge(occSchema);

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

export const updateEstimateMaterialSchema = createEstimateMaterialSchema.partial().merge(occSchema);

// Массовый перенос материалов к другой работе (within one estimate).
// materialIds дедуплицируются; пустой список и >500 элементов отклоняются.
export const reassignMaterialsSchema = z.object({
  itemId: z.string().uuid(),
  materialIds: z
    .array(z.string().uuid())
    .min(1, 'Список материалов пуст')
    .max(500, 'Слишком много материалов за один перенос')
    .transform((ids) => [...new Set(ids)]),
});

// === Массовое удаление работ и материалов сметы ===
// Оба списка дедуплицируются; пустой запрос (0 позиций) и >1000 id отклоняются.
const bulkDeleteIds = z
  .array(z.string().uuid())
  .max(1000, 'Слишком много позиций за одно удаление')
  .default([])
  .transform((ids) => [...new Set(ids)]);
export const bulkDeleteEstimateItemsSchema = z
  .object({ workIds: bulkDeleteIds, materialIds: bulkDeleteIds })
  .refine((d) => d.workIds.length + d.materialIds.length > 0, {
    message: 'Не выбрано ни одной позиции',
  });

// Выборочное согласование работ и материалов сметы (снятие needs_review) — та же форма, что и удаление.
export const bulkConfirmEstimateItemsSchema = z
  .object({ workIds: bulkDeleteIds, materialIds: bulkDeleteIds })
  .refine((d) => d.workIds.length + d.materialIds.length > 0, {
    message: 'Не выбрано ни одной позиции',
  });

// Нормализующая перестановка работ внутри вида: полный список id работ в новом порядке.
export const reorderEstimateItemsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Список работ пуст').max(1000, 'Слишком много работ'),
});

// Массовое назначение одного местоположения набору выбранных работ (перезаписывает locations + зеркало).
// locations — источник истины (одна запись {zoneId, floors}); очистка локации этой операцией не предусмотрена.
export const bulkAssignEstimateItemsLocationSchema = z.object({
  workIds: z
    .array(z.string().uuid())
    .min(1, 'Не выбрано ни одной работы')
    .max(1000, 'Слишком много работ за одно назначение')
    .transform((ids) => [...new Set(ids)]),
  locations: z.array(locationEntrySchema).min(1, 'Не выбрано местоположение').max(100),
});

// === Подрядчик на вид затрат (estimate + cost_type) ===
export const setEstimateContractorSchema = z.object({
  costTypeId: z.string().uuid(),
  contractorId: z.string().uuid(),
});

// === Назначение подрядчика на строки сметы (раздел «Подрядчики») ===
// Список строк дедуплицируется; пустой и >1000 id отклоняются.
const assignItemIds = z
  .array(z.string().uuid())
  .min(1, 'Не выбрано ни одной строки')
  .max(1000, 'Слишком много строк за одно назначение')
  .transform((ids) => [...new Set(ids)]);

// Режимы назначения (взаимоисключающие). Массовый абсолютный qty не допускается —
// строки бывают в разных единицах/объёмах, поэтому qty задаётся только пер-строка массивом пар.
export const assignItemContractorsSchema = z.discriminatedUnion('mode', [
  // один процент на выбранные строки
  z.object({
    mode: z.literal('percent'),
    contractorId: z.string().uuid(),
    itemIds: assignItemIds,
    percent: z.number().positive('Процент должен быть > 0').max(100, 'Процент не больше 100'),
  }),
  // «весь остаток» по каждой выбранной строке
  z.object({
    mode: z.literal('remainder'),
    contractorId: z.string().uuid(),
    itemIds: assignItemIds,
  }),
  // абсолютные объёмы — только пер-строка массивом пар
  z.object({
    mode: z.literal('qty'),
    contractorId: z.string().uuid(),
    assignments: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          assignedQty: z.number().positive('Объём должен быть > 0'),
        }),
      )
      .min(1, 'Не выбрано ни одной строки')
      .max(1000, 'Слишком много строк за одно назначение'),
  }),
  // на вид работ целиком — все ТЕКУЩИЕ строки cost_type сметы (новые не наследуют)
  z.object({
    mode: z.literal('cost_type'),
    contractorId: z.string().uuid(),
    estimateId: z.string().uuid(),
    costTypeId: z.string().uuid(),
    percent: z.number().positive().max(100).nullable().optional(),
  }),
]);

// Снять подрядчика со строк: contractorId не задан → снять всех подрядчиков с этих строк.
export const clearItemContractorsSchema = z.object({
  itemIds: assignItemIds,
  contractorId: z.string().uuid().nullable().optional(),
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
export type ReassignMaterialsInput = z.infer<typeof reassignMaterialsSchema>;
export type EstimateMaterialStatus = z.infer<typeof estimateMaterialStatusSchema>;
export type SetEstimateContractorInput = z.infer<typeof setEstimateContractorSchema>;
export type AssignItemContractorsInput = z.infer<typeof assignItemContractorsSchema>;
export type ClearItemContractorsInput = z.infer<typeof clearItemContractorsSchema>;
export type BulkDeleteEstimateItemsInput = z.infer<typeof bulkDeleteEstimateItemsSchema>;
export type BulkConfirmEstimateItemsInput = z.infer<typeof bulkConfirmEstimateItemsSchema>;
export type ReorderEstimateItemsInput = z.infer<typeof reorderEstimateItemsSchema>;
export type Estimate = z.infer<typeof estimateSchema>;
