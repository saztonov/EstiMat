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

// Статусы заявки подрядчика на материалы. Подрядчик создаёт заявку в статусе 'sent';
// дальнейшие статусы ('rp_created', 'paid') проставляют внешние сервисы закупки/оплаты.
export const MATERIAL_REQUEST_STATUSES = ['sent', 'rp_created', 'paid'] as const;
export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

export const MATERIAL_REQUEST_STATUS_LABELS: Record<MaterialRequestStatus, string> = {
  sent: 'Отправлено',
  rp_created: 'Создан РП',
  paid: 'Оплачено',
};
