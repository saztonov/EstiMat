import { z } from 'zod';
import { ORG_TYPES } from '../constants/statuses.js';
import { innStrictSchema, innLenientSchema } from './common.js';

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Название обязательно').max(300),
  // Необязательные поля допускают null: при редактировании форма (Ant Design)
  // присылает NULL-значения из БД для незаполненных колонок.
  inn: innStrictSchema.optional(),
  type: z.enum(ORG_TYPES),
  contacts: z.record(z.string().max(500)).nullish()
    .refine((v) => v == null || Object.keys(v).length <= 50, 'Слишком много контактов'),
  address: z.string().max(500).nullish(),
  // Альтернативные наименования (напр. на латинице) — массив строк, хранится в jsonb.
  alternative_names: z.array(z.string().max(300)).max(50).nullish(),
});

// Обновление: ИНН мягкий (не блокирует ранее заведённые контрагенты с «грязным» ИНН).
export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  inn: innLenientSchema.optional(),
});

// Назначение организации-подрядчику набора объектов (REPLACE): полный список project_id.
export const assignOrgProjectsSchema = z.object({
  projectIds: z.array(z.string().uuid()),
});

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
export type AssignOrgProjectsInput = z.infer<typeof assignOrgProjectsSchema>;
