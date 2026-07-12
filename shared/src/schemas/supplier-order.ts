import { z } from 'zod';
import { PROCUREMENT_METHODS, TENDER_STATUSES } from '../constants/statuses.js';

// ===== Вход (клиент → сервер) =====

// Одна позиция лота при формировании: ссылка на исходную строку заявки + итоговое количество
// в лоте (абсолютное, не приращение — повтор запроса идемпотентен).
export const lotItemSchema = z.object({
  requestItemId: z.string().uuid(),
  quantity: z.number().positive(),
});
export type LotItemInput = z.infer<typeof lotItemSchema>;

// Формирование/дополнение закупочного лота (снабженец). orderId пуст → создать новый лот;
// задан → добавить позиции в существующий формируемый лот. clientRequestId — идемпотентность.
export const formLotSchema = z.object({
  projectId: z.string().uuid(),
  orderId: z.string().uuid().nullish(),
  title: z.string().max(300).nullish(),
  clientRequestId: z.string().min(8),
  items: z.array(lotItemSchema).min(1, 'Не выбраны материалы'),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type FormLotInput = z.infer<typeof formLotSchema>;

// Условия лота, передаваемые в тендерный портал.
export const tenderConditionsSchema = z.object({
  deadlineAt: z.string().nullish(), // ISO datetime — дедлайн приёма ставок
  delivery: z.string().max(500).nullish(),
  payment: z.string().max(500).nullish(),
  deadline: z.string().max(500).nullish(), // срок поставки (текст)
});
export type TenderConditionsInput = z.infer<typeof tenderConditionsSchema>;

// Старт закупки: заморозить состав лота и выбрать канал.
export const startProcurementSchema = z.object({
  method: z.enum(PROCUREMENT_METHODS),
  tender: tenderConditionsSchema.nullish(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type StartProcurementInput = z.infer<typeof startProcurementSchema>;

// Регистрация коммерческого предложения по лоту (manual-канал).
export const addOfferSchema = z.object({
  supplierId: z.string().uuid().nullish(),
  supplierName: z.string().min(1).max(300),
  supplierInn: z.string().regex(/^\d{10}(\d{2})?$/, 'ИНН 10 или 12 цифр').nullish(),
  amount: z.number().positive(),
  currency: z.string().length(3).default('RUB'),
  terms: z.string().max(1000).nullish(),
  note: z.string().max(1000).nullish(),
  fileId: z.string().uuid().nullish(),
  submittedAt: z.string().nullish(), // ISO date
});
export type AddOfferInput = z.infer<typeof addOfferSchema>;

// Присуждение лота (award). Для manual — по quoteId (сумму/поставщика берёт сервер из КП);
// для tender — по winnerParticipantId (сервер резолвит ставку/сумму из сохранённых результатов).
export const awardSchema = z.object({
  source: z.enum(['manual', 'tender']),
  quoteId: z.string().uuid().nullish(),
  winnerParticipantId: z.string().nullish(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type AwardInput = z.infer<typeof awardSchema>;

// ===== Runtime-схемы ответов тендерного портала (валидация на границе) =====

export const tenderSchema = z.object({
  id: z.string(),
  external_ref: z.string().nullish(),
  status: z.enum(TENDER_STATUSES),
  url: z.string().nullish(),
});
export type TenderDto = z.infer<typeof tenderSchema>;

export const tenderParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  inn: z.string().nullish(),
});

export const tenderBidSchema = z.object({
  participant_id: z.string(),
  amount: z.number(),
  currency: z.string().nullish(),
  delivery_terms: z.string().nullish(),
  payment_terms: z.string().nullish(),
  submitted_at: z.string().nullish(),
});

export const tenderResultsSchema = z.object({
  tender_id: z.string(),
  status: z.enum(TENDER_STATUSES),
  participants: z.array(tenderParticipantSchema).default([]),
  bids: z.array(tenderBidSchema).default([]),
  winner: z.object({ participant_id: z.string(), bid_index: z.number().int().nonnegative().nullish() }).nullish(),
  finished_at: z.string().nullish(),
});
export type TenderResultsDto = z.infer<typeof tenderResultsSchema>;
