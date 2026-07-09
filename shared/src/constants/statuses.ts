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
export const MATERIAL_REQUEST_STATUSES = ['created', 'sent', 'rp_created', 'paid'] as const;
export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

export const MATERIAL_REQUEST_STATUS_LABELS: Record<MaterialRequestStatus, string> = {
  created: 'Создана',
  sent: 'Отправлено',
  rp_created: 'Создан РП',
  paid: 'Оплачено',
};

// Тип (маршрут) заявки на материалы. Подрядчик выбирает при создании:
//   own_supplier — свой поставщик, оплата через распределительное письмо (РП) в BillHub;
//   su10         — закупка через СУ-10 (материалы распределяют менеджеры; раздел в разработке);
//   legacy       — исторические заявки, созданные до появления выбора типа.
export const MATERIAL_REQUEST_TYPES = ['own_supplier', 'su10'] as const;
export type MaterialRequestType = (typeof MATERIAL_REQUEST_TYPES)[number];

export const MATERIAL_REQUEST_TYPE_LABELS: Record<MaterialRequestType | 'legacy', string> = {
  own_supplier: 'Свой поставщик (РП)',
  su10: 'Закупка через СУ-10',
  legacy: 'Без типа',
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
