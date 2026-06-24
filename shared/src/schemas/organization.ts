import { z } from 'zod';
import { ORG_TYPES } from '../constants/statuses.js';

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  // Необязательные поля допускают null: при редактировании форма (Ant Design)
  // присылает NULL-значения из БД для незаполненных колонок.
  inn: z.string().nullish(),
  type: z.enum(ORG_TYPES),
  contacts: z.record(z.string()).nullish(),
  address: z.string().nullish(),
  // Альтернативные наименования (напр. на латинице) — массив строк, хранится в jsonb.
  alternative_names: z.array(z.string()).nullish(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  inn: z.string().nullable(),
  type: z.enum(ORG_TYPES),
  contacts: z.record(z.string()).nullable(),
  address: z.string().nullable(),
  alternative_names: z.array(z.string()).default([]),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type Organization = z.infer<typeof organizationSchema>;
