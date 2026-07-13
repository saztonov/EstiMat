import { z } from 'zod';
import { MATERIAL_REQUEST_TYPES, REQUEST_DOC_TYPES } from '../constants/statuses.js';

// Одна строка заявки на материал. Идентификация материала — тем же ключом свёртки,
// что клиент строит в aggregateMaterials (id:<material_id>|<ед> либо txt:<name>|<ед>),
// плюс cost_type_id вида работ (один материал в разных видах работ = разные строки свода).
export const materialRequestLineSchema = z.object({
  costTypeId: z.string().uuid().nullable(),
  aggKey: z.string().min(1),
  materialId: z.string().uuid().nullable(),
  name: z.string().min(1),
  unit: z.string(),
  quantity: z.number().positive(),
});

// Legacy-схема (старый POST /api/material-requests). Оставлена для обратной совместимости.
export const createMaterialRequestSchema = z.object({
  estimateId: z.string().uuid(),
  requestType: z.enum(MATERIAL_REQUEST_TYPES),
  lines: z.array(materialRequestLineSchema).min(1, 'Пустая заявка'),
});

// Создание заявки (единый раздел «Заявки»). Для «Оплата по РП» подрядчик может сразу
// указать поставщика и сумму (прямой заказ). Файлы прикрепляются отдельными запросами.
export const createRequestSchema = z.object({
  estimateId: z.string().uuid(),
  requestType: z.enum(MATERIAL_REQUEST_TYPES),
  lines: z.array(materialRequestLineSchema).min(1, 'Пустая заявка'),
  // Клиентский ключ идемпотентности (защита от двойного POST).
  createRequestId: z.string().min(8),
  // Реквизиты прямого заказа (только own_supplier / own_supply): опциональны при создании.
  supplierName: z.string().min(1).max(300).nullish(),
  supplierInn: z.string().regex(/^\d{10}(\d{2})?$/, 'ИНН 10 или 12 цифр').nullish(),
  resultAmount: z.number().positive().nullish(),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

// Отправка заявки на доработку (внутренние роли; комментарий обязателен).
export const requestRevisionSchema = z.object({
  comment: z.string().min(1, 'Укажите, что доработать'),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type RequestRevisionInput = z.infer<typeof requestRevisionSchema>;

// Завершение доработки подрядчиком: правки позиций/реквизитов + возврат в работу.
export const completeRevisionSchema = z.object({
  lines: z.array(materialRequestLineSchema).min(1).optional(),
  supplierName: z.string().min(1).max(300).nullish(),
  supplierInn: z.string().regex(/^\d{10}(\d{2})?$/, 'ИНН 10 или 12 цифр').nullish(),
  resultAmount: z.number().positive().nullish(),
  comment: z.string().max(2000).nullish(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type CompleteRevisionInput = z.infer<typeof completeRevisionSchema>;

// Прямой выбор поставщика по заявке (РП / собственная закупка): создаёт/обновляет прямой заказ.
// Доступно подрядчику (для своих прямых маршрутов) и внутренним ролям.
export const directSupplierSchema = z.object({
  supplierName: z.string().min(1).max(300),
  supplierInn: z.string().regex(/^\d{10}(\d{2})?$/, 'ИНН 10 или 12 цифр').nullish(),
  resultAmount: z.number().positive(),
  rpNumber: z.string().max(100).nullish(),
  rpDate: z.string().nullish(), // ISO date
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type DirectSupplierInput = z.infer<typeof directSupplierSchema>;

// Регистрация оплаты по заказу заявки (частичные оплаты допускаются).
// clientPaymentId — ключ идемпотентности (защита от двойного POST); fileId — платёжный документ.
export const createPaymentSchema = z.object({
  amount: z.number().positive(),
  paidAt: z.string().nullish(), // ISO date
  docNumber: z.string().max(100).nullish(),
  comment: z.string().max(1000).nullish(),
  clientPaymentId: z.string().min(8).nullish(),
  fileId: z.string().uuid().nullish(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

// ===== РП-поток (заявки типа own_supplier) =====

// «Оформить РП» (подрядчик): поставщик берётся из справочника по supplierId (имя/ИНН/статус СБ —
// на сервере), плюс реквизиты поставки и сумма счёта. Заявка → 'rp_forming'.
export const rpApplicationSchema = z.object({
  supplierId: z.string().uuid(),
  deliveryDays: z.number().int().positive(),
  deliveryDaysType: z.enum(['working', 'calendar']).default('working'),
  shippingConditions: z.string().min(1).max(500),
  invoiceAmount: z.number().positive(),
  comment: z.string().max(2000).nullish(),
  expectedVersion: z.number().int().nonnegative(),
});
export type RpApplicationInput = z.infer<typeof rpApplicationSchema>;

// Правка реквизитов оформленной заявки (own_supplier, статус 'rp_forming'): те же поля, что
// при оформлении, но без смены статуса. При смене поставщика/суммы обязателен новый счёт
// (replacementInvoiceFileId) — прежние действующие счета вычёркиваются на сервере.
export const orderEditSchema = z.object({
  supplierId: z.string().uuid(),
  deliveryDays: z.number().int().positive(),
  deliveryDaysType: z.enum(['working', 'calendar']).default('working'),
  shippingConditions: z.string().min(1).max(500),
  invoiceAmount: z.number().positive(),
  comment: z.string().max(2000).nullish(),
  replacementInvoiceFileId: z.string().uuid().nullish(),
  expectedVersion: z.number().int().nonnegative(),
});
export type OrderEditInput = z.infer<typeof orderEditSchema>;

// Вычёркивание/восстановление документа заявки (is_rejected — «неактуальный» файл).
export const setFileRejectionSchema = z.object({
  isRejected: z.boolean(),
});
export type SetFileRejectionInput = z.infer<typeof setFileRejectionSchema>;

// «Отправить РП» (инженер): дата и описание письма; номер присваивает PayHub.
export const rpSendSchema = z.object({
  rpDate: z.string(), // ISO date
  subject: z.string().max(500).nullish(),
  content: z.string().max(4000).nullish(),
  expectedVersion: z.number().int().nonnegative(),
});
export type RpSendInput = z.infer<typeof rpSendSchema>;

// Отмена заявки до отправки РП.
export const cancelRequestSchema = z.object({
  reason: z.string().max(500).nullish(),
  expectedVersion: z.number().int().nonnegative(),
});
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

// Метаданные при загрузке файла (doc_type приходит полем multipart).
export const requestFileMetaSchema = z.object({
  docType: z.enum(REQUEST_DOC_TYPES).default('invoice'),
});
export type RequestFileMetaInput = z.infer<typeof requestFileMetaSchema>;

export type MaterialRequestLineInput = z.infer<typeof materialRequestLineSchema>;
export type CreateMaterialRequestInput = z.infer<typeof createMaterialRequestSchema>;
