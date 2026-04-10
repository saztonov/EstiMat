import { z } from 'zod';

export const createCostCategorySchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  code: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export const createCostTypeSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1, 'Название обязательно'),
  code: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export const createRateSchema = z.object({
  costTypeId: z.string().uuid(),
  name: z.string().min(1, 'Название обязательно'),
  code: z.string().optional(),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  price: z.number().min(0, 'Цена не может быть отрицательной'),
  description: z.string().optional(),
});

export const updateRateSchema = createRateSchema.partial().omit({ costTypeId: true });

export type CreateCostCategoryInput = z.infer<typeof createCostCategorySchema>;
export type CreateCostTypeInput = z.infer<typeof createCostTypeSchema>;
export type CreateRateInput = z.infer<typeof createRateSchema>;
export type UpdateRateInput = z.infer<typeof updateRateSchema>;
