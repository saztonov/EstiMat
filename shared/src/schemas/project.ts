import { z } from 'zod';
import { PROJECT_STATUSES } from '../constants/statuses.js';

export const createProjectSchema = z.object({
  code: z.string().min(3).max(6, 'Код: 3-6 символов'),
  name: z.string().min(1, 'Название обязательно'),
  fullName: z.string().optional(),
  orgId: z.string().uuid(),
  address: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).default('planning'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  imageUrl: z.string().nullable().optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const projectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  fullName: z.string().nullable(),
  orgId: z.string().uuid(),
  address: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  imageUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type Project = z.infer<typeof projectSchema>;
