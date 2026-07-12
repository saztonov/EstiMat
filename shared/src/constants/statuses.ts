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

// Типы прикрепляемых документов (заявка/заказ/оплата/поставка).
export const REQUEST_DOC_TYPES = [
  'invoice',
  'quote',
  'spec',
  'contract',
  'payment',
  'delivery',
  'other',
] as const;
export type RequestDocType = (typeof REQUEST_DOC_TYPES)[number];

export const REQUEST_DOC_TYPE_LABELS: Record<RequestDocType, string> = {
  invoice: 'Счёт',
  quote: 'КП',
  spec: 'Спецификация',
  contract: 'Договор',
  payment: 'Платёжный документ',
  delivery: 'Документ поставки',
  other: 'Прочее',
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

// Статус оплаты заявки (отдельная ось, приходит из BillHub).
export const PAYMENT_PAID_STATUSES = ['not_paid', 'partially_paid', 'paid'] as const;
export type PaymentPaidStatus = (typeof PAYMENT_PAID_STATUSES)[number];

export const PAYMENT_PAID_STATUS_LABELS: Record<PaymentPaidStatus, string> = {
  not_paid: 'Не оплачено',
  partially_paid: 'Частично оплачено',
  paid: 'Оплачено',
};
