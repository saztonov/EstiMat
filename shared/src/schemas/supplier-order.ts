import { z } from 'zod';
import {
  PROCUREMENT_METHODS, TENDER_STATUSES, TENDER_OUTCOMES, TENDER_VAT_RATES,
  MANUAL_VAT_RATES, PAYMENT_TYPES, OFFER_RESPONSE_STATUSES, OFFER_DOC_TYPES,
} from '../constants/statuses.js';
import { deliveryScheduleEntrySchema } from './material-request.js';

// Деньги — десятичной строкой (без float): до 13 знаков целой части и ≤2 дробной. Считаем в SQL numeric.
const money2 = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Некорректная сумма');

// ===== Вход (клиент → сервер) =====

// Одна позиция лота при формировании: ссылка на исходную строку заявки + итоговое количество
// в лоте (абсолютное, не приращение — повтор запроса идемпотентен).
export const lotItemSchema = z.object({
  requestItemId: z.string().uuid(),
  quantity: z.number().positive(),
});
export type LotItemInput = z.infer<typeof lotItemSchema>;

// График поставки заказа/тендера по АГРЕГАТУ материала (agg_key) — тот же ключ, что в позициях
// заказа и оформлении победителя (в agg_key закодирована единица). Сумма entries по agg_key должна
// равняться суммарному количеству позиций этого agg_key в заказе (проверка — на сервере).
export const orderDeliveryScheduleSchema = z.array(
  z.object({
    aggKey: z.string().min(1),
    entries: z.array(deliveryScheduleEntrySchema).min(1),
  }),
);
export type OrderDeliveryScheduleInput = z.infer<typeof orderDeliveryScheduleSchema>;

// Правка графика поставки заказа снабжением (только стадия forming).
export const putOrderDeliveryScheduleSchema = z.object({
  schedule: orderDeliveryScheduleSchema,
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type PutOrderDeliveryScheduleInput = z.infer<typeof putOrderDeliveryScheduleSchema>;

// Формирование/дополнение закупочного лота (снабженец). orderId пуст → создать новый лот;
// задан → добавить позиции в существующий формируемый лот. clientRequestId — идемпотентность.
// deliverySchedule (опц.) — заданный снабжением график заказа; не задан → предзаполнится снимком заявки.
export const formLotSchema = z.object({
  projectId: z.string().uuid(),
  orderId: z.string().uuid().nullish(),
  title: z.string().max(300).nullish(),
  clientRequestId: z.string().min(8),
  items: z.array(lotItemSchema).min(1, 'Не выбраны материалы'),
  deliverySchedule: orderDeliveryScheduleSchema.optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type FormLotInput = z.infer<typeof formLotSchema>;

// Условия лота, передаваемые в тендерный портал. Дедлайн приёма ставок обязателен и должен быть в
// будущем (портал zakupki требует deadline_at); финальная проверка «в будущем» — на сервере.
export const tenderConditionsSchema = z.object({
  deadlineAt: z.string().datetime({ message: 'Укажите дедлайн приёма ставок' }), // ISO datetime
  vatRate: z.enum(TENDER_VAT_RATES).default('vat20'),
  place: z.string().max(500).nullish(),    // место поставки
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

// ===== Оформление заказа поставщику (ручной канал: одно окно) =====

// Атомарное создание заказа-тендера из выбранных материалов (без промежуточного manual-заказа):
// создать позиции + зарезервировать остаток + tender.create в outbox в одной транзакции.
export const createTenderOrderSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(300).nullish(),
  clientRequestId: z.string().min(8),
  items: z.array(lotItemSchema).min(1, 'Не выбраны материалы'),
  tender: tenderConditionsSchema,
});
export type CreateTenderOrderInput = z.infer<typeof createTenderOrderSchema>;

// Добавить/обновить поставщика-предложение. Сумма НЕОБЯЗАТЕЛЬНА (поставщика можно добавить только с файлом).
export const upsertOfferSchema = z.object({
  supplierId: z.string().uuid().nullish(),
  supplierName: z.string().min(1).max(300),
  supplierInn: z.string().regex(/^\d{10}(\d{2})?$/, 'ИНН 10 или 12 цифр').nullish(),
  amount: money2.nullish(),
  responseStatus: z.enum(OFFER_RESPONSE_STATUSES).optional(),
  terms: z.string().max(1000).nullish(),
  note: z.string().max(1000).nullish(),
});
export type UpsertOfferInput = z.infer<typeof upsertOfferSchema>;

// Метаданные при загрузке файла предложения (тип документа — КП/счёт — приходит query-параметром).
export const offerFileMetaSchema = z.object({
  documentType: z.enum(OFFER_DOC_TYPES).default('quote'),
});
export type OfferFileMetaInput = z.infer<typeof offerFileMetaSchema>;

// Одна финансовая строка оформления победителя — по АГРЕГАТУ материала (agg_key), не по исходной позиции.
export const finalizeLineSchema = z.object({
  aggKey: z.string().min(1),
  unitPrice: money2,                 // цена за единицу, без НДС
  warrantyMonths: z.number().int().min(0).max(1200).nullish(),
});

// «Оформить заказ»: победитель + условия + цены → awarded (атомарно).
export const finalizeOrderSchema = z.object({
  winnerOfferId: z.string().uuid(),
  vatRate: z.enum(MANUAL_VAT_RATES),
  paymentType: z.enum(PAYMENT_TYPES),
  lines: z.array(finalizeLineSchema).min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type FinalizeOrderInput = z.infer<typeof finalizeOrderSchema>;

// ===== Правка и отмена уже зафиксированного заказа =====

/**
 * Отмена заказа. Причина обязательна только для ПРИСУЖДЁННОГО заказа (проверка на сервере: у
 * заказа на более ранних стадиях отменять по сути нечего). Тело целиком необязательно — прежний
 * клиент шлёт POST /cancel вообще без него, и он не должен сломаться.
 */
export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/**
 * Отзыв присуждения (смена поставщика): заказ возвращается к сбору предложений.
 * Причина обязательна — это отмена уже принятого руководителем решения.
 */
export const revokeAwardSchema = z.object({
  reason: z.string().trim().min(1, 'Укажите причину смены поставщика').max(2000),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type RevokeAwardInput = z.infer<typeof revokeAwardSchema>;

/**
 * Изменение количества позиции заказа.
 *
 * schedule — график по затронутому материалу (agg_key). Не задан → сервер подгонит сам: при
 * уменьшении списывает с ПОЗДНИХ дат, при увеличении доливает в последнюю. Ближайшие поставки
 * обычно уже согласованы с поставщиком, поэтому корректно резать хвост.
 *
 * Увеличение сверх доступного остатка заявок отклоняется жёстко (инвариант И1) — в отличие от
 * правки объёмов ЗАЯВКИ, где уменьшение ниже размещённого разрешено с подтверждением.
 */
export const patchOrderItemSchema = z.object({
  quantity: z.number().positive(),
  reason: z.string().trim().max(2000).optional(),
  schedule: z.array(deliveryScheduleEntrySchema).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type PatchOrderItemInput = z.infer<typeof patchOrderItemSchema>;

/** Удаление позиции из зафиксированного заказа. Тело необязательно (в forming причина не нужна). */
export const deleteOrderItemSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type DeleteOrderItemInput = z.infer<typeof deleteOrderItemSchema>;

// ===== Комментарий снабжения к заказу =====

/**
 * Заметка о заказе в целом. Сохраняется отдельным запросом и НЕ несёт expectedVersion: комментарий
 * не входит в закупочный контракт, поэтому не конфликтует с параллельной правкой цен или графика.
 * null — очистить.
 */
export const patchOrderCommentSchema = z.object({
  comment: z.string().max(2000).nullable(),
});
export type PatchOrderCommentInput = z.infer<typeof patchOrderCommentSchema>;

// ===== Счета заказа (платёжные документы выбранного поставщика) =====

/**
 * Реквизиты счёта: вводятся вручную либо приезжают из распознавания и правятся человеком.
 * Все поля необязательны — счёт можно приложить сразу, а реквизиты заполнить позже.
 */
export const upsertInvoiceSchema = z.object({
  invoiceNo: z.string().trim().max(100).nullish(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD').nullish(),
  amount: money2.nullish(),
  vatAmount: money2.nullish(),
  note: z.string().max(1000).nullish(),
});
export type UpsertInvoiceInput = z.infer<typeof upsertInvoiceSchema>;

// ===== Согласование поставщика руководителем =====

/** Подтверждение выбранного поставщика. Комментарий необязателен — решение и так фиксируется. */
export const approveOrderSchema = z.object({
  comment: z.string().max(2000).nullish(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type ApproveOrderInput = z.infer<typeof approveOrderSchema>;

/** Отклонение: комментарий обязателен — инженеру нужно понимать, что исправлять. */
export const rejectApprovalSchema = z.object({
  comment: z.string().trim().min(1, 'Укажите причину отклонения').max(2000),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type RejectApprovalInput = z.infer<typeof rejectApprovalSchema>;

// ===== Назначение ответственного за материал (override поверх ответственных по категории) =====

// Назначить/сбросить ответственного за одну строку свода материалов. userId=null — сброс
// (строка снова показывает всех ответственных по категории вида работ).
export const assignMaterialResponsibleSchema = z.object({
  userId: z.string().uuid().nullable(),
});
export type AssignMaterialResponsibleInput = z.infer<typeof assignMaterialResponsibleSchema>;

// Массовое назначение «на группу/вид»: явный набор строк узла дерева (объект/подрядчик/вид/заявка).
// Транзакционно «всё или ничего»; потолок совпадает с потолком свода (MATERIALS_GROUP_CAP=5000).
export const bulkAssignMaterialResponsibleSchema = z.object({
  requestItemIds: z.array(z.string().uuid()).min(1).max(5000),
  userId: z.string().uuid().nullable(),
});
export type BulkAssignMaterialResponsibleInput = z.infer<typeof bulkAssignMaterialResponsibleSchema>;

// ===== Несколько ответственных на строку материала (many-to-many, поверх категорийных) =====

// Массив UUID без дубликатов: валидируем формат и потолок по исходному вводу, затем схлопываем
// повторы (клиент может прислать один id дважды — идемпотентно нормализуем).
const uniqueUuidArray = (min: number, max: number) =>
  z.array(z.string().uuid()).min(min).max(max).transform((arr) => [...new Set(arr)]);

// Полная замена набора ответственных одной строки. Пустой массив — очистить (снова показываются
// все ответственные по категории вида работ).
export const setMaterialResponsiblesSchema = z.object({
  userIds: uniqueUuidArray(0, 50),
});
export type SetMaterialResponsiblesInput = z.infer<typeof setMaterialResponsiblesSchema>;

// Массовое назначение «на группу/вид»: явный набор строк узла дерева. mode='add' — добавить
// выбранных ко всем строкам (не трогая уже назначенных); mode='replace' — заменить набор
// (userIds=[] + replace = массовый сброс). Пустой 'add' бессмысленен → отклоняем.
export const bulkSetMaterialResponsiblesSchema = z.object({
  requestItemIds: uniqueUuidArray(1, 5000),
  userIds: uniqueUuidArray(0, 50),
  mode: z.enum(['add', 'replace']),
}).refine((v) => !(v.mode === 'add' && v.userIds.length === 0), {
  message: 'Для добавления выберите хотя бы одного ответственного',
  path: ['userIds'],
});
export type BulkSetMaterialResponsiblesInput = z.infer<typeof bulkSetMaterialResponsiblesSchema>;

// ===== Runtime-схемы ответов тендерного портала (валидация на границе) =====

export const tenderSchema = z.object({
  id: z.string(),
  external_ref: z.string().nullish(),
  status: z.enum(TENDER_STATUSES),
  url: z.string().nullish(),
  revision: z.number().int().nullish(),      // монотонная версия состояния тендера с портала
  deadline_at: z.string().nullish(),         // актуальный дедлайн (может продлеваться антиснайпингом)
});
export type TenderDto = z.infer<typeof tenderSchema>;

export const tenderParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  inn: z.string().nullish(),
});

// Суммы приходят decimal-строками (портал считает деньги в numeric) — НЕ преобразуем через JS Number.
export const tenderBidSchema = z.object({
  participant_id: z.string(),
  bid_id: z.string().nullish(),
  amount: z.string(),
  currency: z.string().nullish(),
  delivery_terms: z.string().nullish(),
  payment_terms: z.string().nullish(),
  submitted_at: z.string().nullish(),
});

export const tenderResultsSchema = z.object({
  tender_id: z.string(),
  status: z.enum(TENDER_STATUSES),
  outcome: z.enum(TENDER_OUTCOMES).nullish(), // pending | awarded | no_award
  participants: z.array(tenderParticipantSchema).default([]),
  bids: z.array(tenderBidSchema).default([]),
  winner: z
    .object({
      participant_id: z.string(),
      bid_id: z.string().nullish(),
      bid_index: z.number().int().nonnegative().nullish(),
    })
    .nullish(),
  finished_at: z.string().nullish(),
  revision: z.number().int().nullish(),
});
export type TenderResultsDto = z.infer<typeof tenderResultsSchema>;
