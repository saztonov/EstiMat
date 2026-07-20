import { z } from 'zod';

/**
 * Роли, которым разрешено назначать ответственных за закупки и подтверждать поставщика.
 * Единый источник для серверного requireRole и клиентского canEdit — раньше правило дублировалось
 * ad-hoc-константами и разъезжалось между справочником и сводом материалов.
 */
export const PROCUREMENT_ASSIGN_ROLES = ['admin', 'manager'] as const;

// Дата без времени — та же идиома, что в схемах заявок (material-request.ts).
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD');

// ===== Назначение ответственного по уровням =====

/**
 * Ответственный за категорию затрат. userId=null — снять назначение.
 * clearTypeOverrides=true (по умолчанию) реализует правило «назначили на категорию — применилось
 * ко всем видам»: индивидуальные назначения видов внутри категории снимаются, и виды снова
 * наследуют категорийного ответственного.
 */
export const setCategoryResponsibleSchema = z.object({
  userId: z.string().uuid().nullable(),
  clearTypeOverrides: z.boolean().optional().default(true),
});
export type SetCategoryResponsibleInput = z.infer<typeof setCategoryResponsibleSchema>;

/** Ответственный за вид затрат. userId=null — вернуть наследование от категории. */
export const setCostTypeResponsibleSchema = z.object({
  userId: z.string().uuid().nullable(),
});
export type SetCostTypeResponsibleInput = z.infer<typeof setCostTypeResponsibleSchema>;

/**
 * Область материального назначения: один материал в рамках объекта, подрядчика и вида затрат.
 * Совпадает с ключом схлопывания строки свода «Материалы» — одна строка, один ответственный.
 */
export const materialScopeSchema = z.object({
  projectId: z.string().uuid().nullable(),
  contractorId: z.string().uuid().nullable(),
  costTypeId: z.string().uuid().nullable(),
  aggKey: z.string().min(1),
});
export type MaterialScope = z.infer<typeof materialScopeSchema>;

/** Ответственный за материал в области. userId=null — вернуть наследование от вида/категории. */
export const setMaterialResponsibleSchema = z.object({
  scope: materialScopeSchema,
  userId: z.string().uuid().nullable(),
});
export type SetMaterialResponsibleInput = z.infer<typeof setMaterialResponsibleSchema>;

/**
 * Массовое назначение: набор областей из выделенных строк свода. Потолок совпадает с потолком
 * выборки материалов (MATERIALS_GROUP_CAP=5000) — областей всегда не больше, чем строк.
 */
export const bulkSetMaterialResponsibleSchema = z.object({
  scopes: z.array(materialScopeSchema).min(1).max(5000),
  userId: z.string().uuid().nullable(),
});
export type BulkSetMaterialResponsibleInput = z.infer<typeof bulkSetMaterialResponsibleSchema>;

/**
 * Передача назначений другому сотруднику. Без списков — переносится всё; со списками — только
 * указанное. Одной транзакцией: серия отдельных PUT могла бы оборваться на середине и оставить
 * назначения размазанными между двумя людьми.
 */
export const transferAssignmentsSchema = z.object({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  categoryIds: z.array(z.string().uuid()).optional(),
  costTypeIds: z.array(z.string().uuid()).optional(),
  materialIds: z.array(z.string().uuid()).optional(),
}).refine((v) => v.fromUserId !== v.toUserId, {
  message: 'Передать назначения можно только другому сотруднику',
  path: ['toUserId'],
});
export type TransferAssignmentsInput = z.infer<typeof transferAssignmentsSchema>;

// ===== Замещения =====

export const createSubstitutionSchema = z.object({
  principalUserId: z.string().uuid(),
  deputyUserId: z.string().uuid(),
  startsOn: dateString,
  endsOn: dateString,
  reason: z.string().max(300).nullish(),
}).refine((v) => v.endsOn >= v.startsOn, {
  message: 'Дата окончания раньше даты начала',
  path: ['endsOn'],
}).refine((v) => v.principalUserId !== v.deputyUserId, {
  message: 'Замещающий и замещаемый — разные сотрудники',
  path: ['deputyUserId'],
});
export type CreateSubstitutionInput = z.infer<typeof createSubstitutionSchema>;

export const updateSubstitutionSchema = z.object({
  deputyUserId: z.string().uuid().optional(),
  startsOn: dateString.optional(),
  endsOn: dateString.optional(),
  reason: z.string().max(300).nullish(),
});
export type UpdateSubstitutionInput = z.infer<typeof updateSubstitutionSchema>;

// ===== Legacy =====

/**
 * @deprecated Модель «много ответственных на категорию» (0056). Роут оставлен для незакрытых
 * вкладок SPA и перенаправляет на новую одиночную модель; массив длиннее одного отклоняется.
 */
export const setCategoryResponsiblesSchema = z.object({
  userIds: z.array(z.string().uuid()),
});
export type SetCategoryResponsiblesInput = z.infer<typeof setCategoryResponsiblesSchema>;
