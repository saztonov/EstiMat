export const ROLES = ['admin', 'engineer', 'contractor', 'manager'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  engineer: 'Инженер-сметчик',
  contractor: 'Подрядчик',
  manager: 'Руководитель',
};
