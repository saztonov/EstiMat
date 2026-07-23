export const ROLES = ['admin', 'engineer', 'contractor', 'manager'] as const;
export type Role = (typeof ROLES)[number];

/** Все роли, кроме подрядчика: сотрудники компании. Производная от ROLES, а не отдельный список —
 *  новая роль автоматически получает сотрудничий доступ, а не молча остаётся без него. */
export const NON_CONTRACTOR_ROLES = ROLES.filter((r) => r !== 'contractor') as Exclude<Role, 'contractor'>[];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  engineer: 'Инженер-сметчик',
  contractor: 'Подрядчик',
  manager: 'Руководитель',
};
