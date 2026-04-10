import { z } from 'zod';
import { ESTIMATE_STATUSES } from '../constants/statuses.js';

export const createEstimateSchema = z.object({
  projectId: z.string().uuid(),
  contractorId: z.string().uuid().nullable().optional(),
  workType: z.string().optional(),
  notes: z.string().optional(),
});

export const updateEstimateSchema = createEstimateSchema.partial();

export const createEstimateItemSchema = z.object({
  estimateId: z.string().uuid(),
  rateId: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Описание обязательно'),
  quantity: z.number().positive('Количество должно быть положительным'),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  sortOrder: z.number().int().default(0),
});

export const updateEstimateItemSchema = createEstimateItemSchema.partial().omit({ estimateId: true });

export const estimateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  contractorId: z.string().uuid().nullable(),
  workType: z.string().nullable(),
  status: z.enum(ESTIMATE_STATUSES),
  totalAmount: z.string(),
  createdBy: z.string().uuid(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;
export type CreateEstimateItemInput = z.infer<typeof createEstimateItemSchema>;
export type UpdateEstimateItemInput = z.infer<typeof updateEstimateItemSchema>;
export type Estimate = z.infer<typeof estimateSchema>;
