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

// Тип объёма строки: 'main' (осн) / 'additional' (доп). Раздельный учёт работ.
export const volumeTypeSchema = z.enum(['main', 'additional']);

export const createEstimateItemSchema = z.object({
  costTypeId: z.string().uuid().nullable().optional(),
  rateId: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Описание обязательно'),
  quantity: z.number().positive('Количество должно быть положительным'),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  sortOrder: z.number().int().default(0),
  volumeType: volumeTypeSchema.optional(),
  // Сигнал «поставить строку наверх вида затрат» (не колонка БД): сервер вычислит
  // sort_order ниже всех существующих в этом виде. Используется при добавлении из справочника.
  placeOnTop: z.boolean().optional(),
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
  // Коэффициент расхода: если задан — quantity = qtyRatio × объём работы (считает сервер);
  // null/не передан — количество вводится вручную (берётся quantity).
  qtyRatio: z.number().positive('Коэффициент должен быть больше 0').nullable().optional(),
}).merge(sourceTraceSchema);

export const updateEstimateMaterialSchema = createEstimateMaterialSchema.partial().merge(occSchema);

// Одиночный перенос материала к другой работе: :id — материал (path), itemId — целевая работа.
export const reassignMaterialParamsSchema = z.object({ id: z.string().uuid() });
export const reassignMaterialSchema = z.object({ itemId: z.string().uuid() });

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

// Пакетное добавление материалов к работе (подбор из ранее использованных). status не передаётся —
// сервер ставит 'confirmed'; sort_order сервер дописывает в конец работы, сохраняя порядок массива.
export const batchMaterialItemSchema = z.object({
  materialId: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Описание обязательно'),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  quantity: z.number().positive('Количество должно быть положительным').default(1),
  qtyRatio: z.number().positive('Коэффициент должен быть больше 0').nullable().optional(),
});
export const batchCreateEstimateMaterialsSchema = z.object({
  materials: z
    .array(batchMaterialItemSchema)
    .min(1, 'Список материалов пуст')
    .max(200, 'Слишком много материалов за один раз'),
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

// Батч-переключение типа объёма (осн/доп) для набора строк. Last-write-wins, без OCC:
// ленивая запись очереди тумблеров. Дедуп по id (последнее значение wins) — на сервере.
export const setEstimateItemsVolumeTypeSchema = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), volumeType: volumeTypeSchema }))
    .min(1, 'Список строк пуст')
    .max(1000, 'Слишком много строк за одно переключение'),
});

// Массовое копирование параметров на набор выбранных работ: местоположение (locations + зеркало)
// и/или произвольный «тип» строки. Незаполненный параметр не передаётся и НЕ перезаписывается;
// очистка локации/типа этой операцией не предусмотрена.
export const bulkAssignEstimateItemsLocationSchema = z
  .object({
    workIds: z
      .array(z.string().uuid())
      .min(1, 'Не выбрано ни одной работы')
      .max(1000, 'Слишком много работ за одно назначение')
      .transform((ids) => [...new Set(ids)]),
    // Присутствует → перезаписать координаты (одна запись {zoneId, floors}); отсутствует → не трогаем.
    locations: z.array(locationEntrySchema).min(1, 'Не выбрано местоположение').max(100).optional(),
    // Присутствует → upsert в project_location_types и перезапись типа; отсутствует → не трогаем.
    locationTypeName: z.string().trim().min(1).max(100).optional(),
  })
  .refine((d) => d.locations !== undefined || d.locationTypeName !== undefined, {
    message: 'Не задано ни местоположение, ни тип',
  });

// === Подрядчик на вид затрат (estimate + cost_type) ===
export const setEstimateContractorSchema = z.object({
  costTypeId: z.string().uuid(),
  contractorId: z.string().uuid(),
});

// === Назначение подрядчика на строки сметы ===
// Подрядчик назначается и снимается только через реестр «ВОР объекта» (schemas/vor.ts): состав
// строк сервер берёт из самого ВОР, работа достаётся исполнителю целиком. Здесь остались лишь
// коды отказов — они общие для назначения и снятия.
//
// Почему строка не была тронута. Текст подставляет клиент — сервер отдаёт код.
export const assignBlockReasonSchema = z.enum([
  'material_requests', // связь позиции заявки со строкой известна точно
  'material_requests_legacy', // связи нет: заявка старая → блокируем весь вид работ подрядчика
]);

export const assignBlockedItemSchema = z.object({
  itemId: z.string().uuid(),
  // Один объект на СТРОКУ со списком её защищённых подрядчиков: иначе счётчик пропущенных
  // строк разошёлся бы с длиной списка (на строке бывает несколько подрядчиков).
  contractors: z.array(
    z.object({ contractorId: z.string().uuid(), contractorName: z.string().nullable() }),
  ),
  reason: assignBlockReasonSchema,
});

export const estimateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  costCategoryId: z.string().uuid().nullable(),
  workType: z.string().nullable(),
  totalAmount: z.string(),
  createdBy: z.string().uuid().nullable(),
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
export type BatchCreateEstimateMaterialsInput = z.infer<typeof batchCreateEstimateMaterialsSchema>;
export type EstimateMaterialStatus = z.infer<typeof estimateMaterialStatusSchema>;
export type SetEstimateContractorInput = z.infer<typeof setEstimateContractorSchema>;
export type AssignBlockReason = z.infer<typeof assignBlockReasonSchema>;
export type AssignBlockedItem = z.infer<typeof assignBlockedItemSchema>;
export type BulkDeleteEstimateItemsInput = z.infer<typeof bulkDeleteEstimateItemsSchema>;
export type BulkConfirmEstimateItemsInput = z.infer<typeof bulkConfirmEstimateItemsSchema>;
export type ReorderEstimateItemsInput = z.infer<typeof reorderEstimateItemsSchema>;
export type VolumeType = z.infer<typeof volumeTypeSchema>;
export type SetEstimateItemsVolumeTypeInput = z.infer<typeof setEstimateItemsVolumeTypeSchema>;
export type Estimate = z.infer<typeof estimateSchema>;
