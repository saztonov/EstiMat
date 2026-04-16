import { z } from 'zod';
import { ESTIMATE_STATUSES } from '../constants/statuses.js';

export const createEstimateSchema = z.object({
  projectId: z.string().uuid(),
  contractorId: z.string().uuid().nullable().optional(),
  workType: z.string().optional(),
  notes: z.string().optional(),
});

export const updateEstimateSchema = createEstimateSchema.partial();

export const ESTIMATE_ITEM_TYPES = ['work', 'material'] as const;
export type EstimateItemType = (typeof ESTIMATE_ITEM_TYPES)[number];

export const createEstimateSectionSchema = z.object({
  costCategoryId: z.string().uuid(),
  costTypeId: z.string().uuid(),
  sortOrder: z.number().int().default(0),
});

export const updateEstimateSectionSchema = z.object({
  costCategoryId: z.string().uuid().optional(),
  costTypeId: z.string().uuid().optional(),
  sortOrder: z.number().int().optional(),
});

export const createEstimateItemSchema = z.object({
  sectionId: z.string().uuid().optional(),
  itemType: z.enum(ESTIMATE_ITEM_TYPES).default('work'),
  rateId: z.string().uuid().nullable().optional(),
  materialId: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Описание обязательно'),
  quantity: z.number().positive('Количество должно быть положительным'),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  sortOrder: z.number().int().default(0),
});

export const updateEstimateItemSchema = createEstimateItemSchema.partial();

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

export const estimateSectionSchema = z.object({
  id: z.string().uuid(),
  estimateId: z.string().uuid(),
  costTypeId: z.string().uuid().nullable(),
  name: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;
export type CreateEstimateSectionInput = z.infer<typeof createEstimateSectionSchema>;
export type UpdateEstimateSectionInput = z.infer<typeof updateEstimateSectionSchema>;
export type CreateEstimateItemInput = z.infer<typeof createEstimateItemSchema>;
export type UpdateEstimateItemInput = z.infer<typeof updateEstimateItemSchema>;
export type Estimate = z.infer<typeof estimateSchema>;
export type EstimateSection = z.infer<typeof estimateSectionSchema>;
