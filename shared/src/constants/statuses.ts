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
