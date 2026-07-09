import { z } from 'zod';

// Заявка на оплату (EstiMat). Зеркалит поля заявки BillHub (createPaymentRequestBodySchema),
// но подрядчик задаёт ТОЛЬКО: поставщика, условия отгрузки, срок, сумму, комментарий и файлы.
// Объект (site) и контрагент (counterparty) BillHub выводятся сервером из заявки на материалы
// и здесь не принимаются. В BillHub заявка всегда уходит типом 'contractor' (цепочка Штаб→ОМТС→РП).

export const DELIVERY_DAYS_TYPES = ['working', 'calendar'] as const;

// Редактируемые подрядчиком поля черновика (все опциональны на этапе draft).
const paymentRequestDraftFields = {
  bhSupplierId: z.string().min(1).nullish(),
  bhSupplierName: z.string().nullish(),
  bhSupplierInn: z.string().nullish(),
  bhShippingConditionId: z.string().min(1).nullish(),
  bhShippingConditionValue: z.string().nullish(),
  deliveryDays: z.number().int().positive().nullish(),
  deliveryDaysType: z.enum(DELIVERY_DAYS_TYPES).nullish(),
  invoiceAmount: z.number().positive().nullish(),
  comment: z.string().nullish(),
};

// Создание черновика заявки на оплату на основе заявки на материалы.
// createRequestId — клиентский ключ идемпотентности (защита от повторной отправки формы).
export const createPaymentRequestSchema = z.object({
  materialRequestId: z.string().uuid(),
  createRequestId: z.string().min(8),
  ...paymentRequestDraftFields,
});

// Редактирование черновика.
export const updatePaymentRequestSchema = z.object(paymentRequestDraftFields);

export type CreatePaymentRequestInput = z.infer<typeof createPaymentRequestSchema>;
export type UpdatePaymentRequestInput = z.infer<typeof updatePaymentRequestSchema>;
export type DeliveryDaysType = (typeof DELIVERY_DAYS_TYPES)[number];

// Регистрация метаданных файла-счёта (после presign+upload в приватный S3-prefix EstiMat).
export const paymentRequestFileSchema = z.object({
  bhDocumentTypeId: z.string().nullish(),
  fileName: z.string().min(1),
  fileKey: z.string().min(1),
  fileSize: z.number().int().nonnegative().nullish(),
  mimeType: z.string().nullish(),
  checksum: z.string().nullish(),
});
export type PaymentRequestFileInput = z.infer<typeof paymentRequestFileSchema>;

// Событие BillHub → EstiMat (входящий канал). Каждое событие несёт полный snapshot проекции и
// монотонную версию агрегата (для корректного порядка применения).
export const INTEGRATION_EVENT_TYPES = [
  'payment_request.workflow_changed',
  'payment_request.document_attached',
  'payment_request.rp_changed',
  'payment_request.rp_unlinked',
  'payment_request.payment_summary_changed',
] as const;
export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

export const integrationEventSchema = z.object({
  schemaVersion: z.number().int().default(1),
  eventId: z.string().min(1),
  type: z.enum(INTEGRATION_EVENT_TYPES),
  externalRef: z.string().min(1),
  bhRequestId: z.string().min(1).nullish(),
  aggregateVersion: z.number().int().nonnegative(),
  occurredAt: z.string().nullish(),
  correlationId: z.string().nullish(),
  // Полный снимок проекции заявки на оплату на момент события.
  snapshot: z.object({
    statusCode: z.string().nullish(),
    actionRequired: z.boolean().nullish(),
    revisionComment: z.string().nullish(),
    requestNumber: z.string().nullish(),
    requestUrl: z.string().nullish(),
    rpNumber: z.string().nullish(),
    rpDate: z.string().nullish(),
    paidStatus: z.string().nullish(),
    totalPaid: z.number().nullish(),
    lastPaymentDate: z.string().nullish(),
    documents: z
      .array(
        z.object({
          documentId: z.string(),
          documentType: z.string().nullish(),
          fileName: z.string().nullish(),
          mimeType: z.string().nullish(),
          fileSize: z.number().nullish(),
        }),
      )
      .nullish(),
  }),
});
export type IntegrationEventInput = z.infer<typeof integrationEventSchema>;
