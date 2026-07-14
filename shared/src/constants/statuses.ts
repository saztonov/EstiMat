export const PROJECT_STATUSES = ['planning', 'active', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Планирование',
  active: 'Активный',
  completed: 'Завершён',
  archived: 'В архиве',
};

export const ORG_TYPES = ['client', 'general_contractor', 'subcontractor', 'supplier'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  client: 'Заказчик',
  general_contractor: 'Генподрядчик',
  subcontractor: 'Субподрядчик',
  supplier: 'Поставщик',
};

// Статусы заявки подрядчика на материалы. Новые заявки создаются в статусе 'created';
// значения 'sent'/'rp_created'/'paid' — legacy (жизненный цикл оплаты теперь живёт в
// заявке на оплату payment_requests и приходит из BillHub).
// Единый статус жизненного цикла заявки (канонический, material_requests.status).
// Заявка создаётся сразу в 'in_work' (согласование автоматическое, этапов нет).
// Статусы supplier_selected/paid/delivered ВЫЧИСЛЯЮТСЯ доменным сервисом пересчёта
// по фактам (выбор поставщика, оплаты, поставки) и не выставляются вручную;
// in_work/revision — состояние процесса.
// Единый статус жизненного цикла заявки. Статусы rp_forming/rp_sent/rp_paid/cancelled применяются
// только к заявкам типа own_supplier («Оплата по РП»); su10/own_supply используют
// in_work/supplier_selected/paid/delivered. Целостность пары тип↔статус — на уровне роутов.
export const REQUEST_STATUSES = [
  'in_work',
  'revision',
  'supplier_selected',
  'paid',
  'delivered',
  'rp_forming',
  'rp_sent',
  'rp_paid',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  in_work: 'В работе',
  revision: 'На доработке',
  supplier_selected: 'Выбран поставщик',
  paid: 'Оплачено',
  delivered: 'Поставлено',
  rp_forming: 'Оформление РП',
  rp_sent: 'РП отправлено',
  rp_paid: 'РП оплачено',
  cancelled: 'Отменена',
};

// Намёк на тон бейджа (клиент маппит на свою палитру).
export const REQUEST_STATUS_TONE: Record<RequestStatus, 'info' | 'warning' | 'accent' | 'success' | 'done'> = {
  in_work: 'info',
  revision: 'warning',
  supplier_selected: 'accent',
  paid: 'success',
  delivered: 'done',
  rp_forming: 'accent',
  rp_sent: 'info',
  rp_paid: 'success',
  cancelled: 'done',
};

// Статусы, вычисляемые системой по фактам (не выставляются вручную через API).
export const REQUEST_COMPUTED_STATUSES = ['supplier_selected', 'paid', 'delivered', 'rp_paid'] as const;

// Статусы РП, попадающие в «Реестр РП» (заявка отправлена в PayHub / оплачена).
export const RP_REGISTRY_STATUSES = ['rp_sent', 'rp_paid'] as const;

// Legacy-статусы заявки (до единого жизненного цикла) — только для backfill/справки.
export const MATERIAL_REQUEST_STATUSES = ['created', 'sent', 'rp_created', 'paid'] as const;
export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

// Вид (маршрут) заявки. Подрядчик выбирает при создании:
//   own_supplier — оплата через распределительное письмо (РП): свой поставщик;
//   su10         — закупка через СУ-10 (снабжение выбирает поставщика, ведёт заказ);
//   own_supply   — собственная закупка подрядчиком.
export const MATERIAL_REQUEST_TYPES = ['own_supplier', 'su10', 'own_supply'] as const;
export type MaterialRequestType = (typeof MATERIAL_REQUEST_TYPES)[number];

export const MATERIAL_REQUEST_TYPE_LABELS: Record<MaterialRequestType, string> = {
  own_supplier: 'Оплата по РП',
  su10: 'Закупка через СУ-10',
  own_supply: 'Собственная закупка',
};

// Типы прикрепляемых документов (снимок операционного справочника BillHub) + платёжный.
export const REQUEST_DOC_TYPES = [
  'invoice',        // Счет (обязательный для оформления РП)
  'contract',       // Договор поставки
  'spec',           // Спецификация
  'proxy',          // Доверенность
  'protocol',       // Протокол
  'approval',       // Согласование
  'rp_su10',        // Распред.письмо в адрес СУ-10
  'docs_set',       // Комплект документов
  'founding_docs',  // Учредительные документы
  'payment',        // Платёжный документ (регистрируется снабжением при оплате)
] as const;
export type RequestDocType = (typeof REQUEST_DOC_TYPES)[number];

export const REQUEST_DOC_TYPE_LABELS: Record<RequestDocType, string> = {
  invoice: 'Счет',
  contract: 'Договор поставки',
  spec: 'Спецификация',
  proxy: 'Доверенность',
  protocol: 'Протокол',
  approval: 'Согласование',
  rp_su10: 'Распред.письмо в адрес СУ-10',
  docs_set: 'Комплект документов',
  founding_docs: 'Учредительные документы',
  payment: 'Платёжный документ',
};

// Типы документов, доступные подрядчику в форме «Оформить РП» (без платёжных).
export const RP_APPLICATION_DOC_TYPES = [
  'invoice', 'contract', 'spec', 'proxy', 'protocol', 'approval', 'rp_su10', 'docs_set', 'founding_docs',
] as const;

// Варианты условий отгрузки (снимок справочника BillHub) — хранятся текстом.
export const SHIPPING_CONDITIONS = ['Предоплата / Аванс', 'Отсрочка'] as const;
export type ShippingCondition = (typeof SHIPPING_CONDITIONS)[number];

// Адресат комментария в чате заявки: null = «Всем».
export const COMMENT_RECIPIENTS = ['contractor', 'supply'] as const;
export type CommentRecipient = (typeof COMMENT_RECIPIENTS)[number];
export const COMMENT_RECIPIENT_LABELS: Record<CommentRecipient, string> = {
  contractor: 'Подрядчику',
  supply: 'Снабжению',
};

// Статусы согласования заявки на оплату (проекция из BillHub, entity_type='payment_request').
export const PAYMENT_REQUEST_STATUSES = [
  'approv_shtab',
  'approv_omts',
  'approv_rp',
  'approved',
  'revision',
  'rejected',
  'withdrawn',
] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PAYMENT_REQUEST_STATUS_LABELS: Record<PaymentRequestStatus, string> = {
  approv_shtab: 'Согласование: Штаб',
  approv_omts: 'Согласование: ОМТС',
  approv_rp: 'Согласование: РП',
  approved: 'Согласована',
  revision: 'На доработке',
  rejected: 'Отклонена',
  withdrawn: 'Отозвана',
};

// ===== Закупочные лоты СУ-10 (supplier_orders.kind='sourcing') =====

// Стадия жизненного цикла лота (ось процесса; не путать с каналом закупки и статусом тендера):
//   forming — редактируется снабженцем, резервирует остаток материалов заявок;
//   sourcing — состав заморожен, идёт сбор КП (почта) или тендер;
//   awarded — поставщик зафиксирован (победитель тендера / лучшее КП);
//   cancel_pending — запрошена отмена внешнего тендера (остаток ещё резервируется);
//   cancelled — лот отменён, остаток освобождён;
//   no_award — тендер завершён без победителя, остаток освобождён (терминальная стадия).
export const SOURCING_STATUSES = [
  'forming',
  'sourcing',
  'awarded',
  'cancel_pending',
  'cancelled',
  'no_award',
] as const;
export type SourcingStatus = (typeof SOURCING_STATUSES)[number];

export const SOURCING_STATUS_LABELS: Record<SourcingStatus, string> = {
  forming: 'Формируется',
  sourcing: 'Закупка',
  awarded: 'Поставщик выбран',
  cancel_pending: 'Отмена тендера',
  cancelled: 'Отменён',
  no_award: 'Без победителя',
};

export const SOURCING_STATUS_TONE: Record<SourcingStatus, 'info' | 'warning' | 'accent' | 'success' | 'done'> = {
  forming: 'info',
  sourcing: 'accent',
  awarded: 'success',
  cancel_pending: 'warning',
  cancelled: 'done',
  no_award: 'done',
};

// Канал закупки лота (взаимоисключающий в v1): фиксируется при старте закупки.
export const PROCUREMENT_METHODS = ['manual', 'tender'] as const;
export type ProcurementMethod = (typeof PROCUREMENT_METHODS)[number];

export const PROCUREMENT_METHOD_LABELS: Record<ProcurementMethod, string> = {
  manual: 'По почте (запрос КП)',
  tender: 'Тендер',
};

// Статус тендера на внешней площадке (снимок с портала; ось интеграции). Значения — уже после
// маппинга портала zakupki (collecting→published, under_review→awaiting_results, awarded/closed→finished).
export const TENDER_STATUSES = ['draft', 'published', 'awaiting_results', 'finished', 'cancelled'] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];

// Итог тендера в отдаваемых порталом результатах: приём идёт / выбран победитель / без победителя.
export const TENDER_OUTCOMES = ['pending', 'awarded', 'no_award'] as const;
export type TenderOutcome = (typeof TENDER_OUTCOMES)[number];

// Ставка НДS тендера (совпадает с перечнем портала zakupki).
export const TENDER_VAT_RATES = ['vat20', 'vat10', 'vat0', 'none'] as const;
export type TenderVatRate = (typeof TENDER_VAT_RATES)[number];

export const TENDER_VAT_RATE_LABELS: Record<TenderVatRate, string> = {
  vat20: 'НДС 20%',
  vat10: 'НДС 10%',
  vat0: 'НДС 0%',
  none: 'Без НДС',
};

export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  awaiting_results: 'Ожидание результатов',
  finished: 'Завершён',
  cancelled: 'Отменён',
};

// Нетерминальные статусы тендера — их poller продолжает опрашивать.
export const TENDER_ACTIVE_STATUSES = ['draft', 'published', 'awaiting_results'] as const;

// Статус оплаты заявки (отдельная ось, приходит из BillHub).
export const PAYMENT_PAID_STATUSES = ['not_paid', 'partially_paid', 'paid'] as const;
export type PaymentPaidStatus = (typeof PAYMENT_PAID_STATUSES)[number];

export const PAYMENT_PAID_STATUS_LABELS: Record<PaymentPaidStatus, string> = {
  not_paid: 'Не оплачено',
  partially_paid: 'Частично оплачено',
  paid: 'Оплачено',
};
