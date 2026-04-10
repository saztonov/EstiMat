import { z } from 'zod';
import { ORG_TYPES } from '../constants/statuses.js';

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  inn: z.string().optional(),
  type: z.enum(ORG_TYPES),
  contacts: z.record(z.string()).optional(),
  address: z.string().optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  inn: z.string().nullable(),
  type: z.enum(ORG_TYPES),
  contacts: z.record(z.string()).nullable(),
  address: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type Organization = z.infer<typeof organizationSchema>;
