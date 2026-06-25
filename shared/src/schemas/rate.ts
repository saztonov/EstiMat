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

// Обновление категории/вида (переименование, код, порядок) — все поля опциональны.
export const updateCostCategorySchema = createCostCategorySchema.partial();
export const updateCostTypeSchema = createCostTypeSchema.partial().omit({ categoryId: true });

// Нормализующая перестановка: полный список id в новом порядке → sort_order = 0,1,2,…
export const reorderCategoriesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Список категорий пуст'),
});
export const reorderTypesSchema = z.object({
  categoryId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1, 'Список видов работ пуст'),
});

export type CreateCostCategoryInput = z.infer<typeof createCostCategorySchema>;
export type CreateCostTypeInput = z.infer<typeof createCostTypeSchema>;
export type CreateRateInput = z.infer<typeof createRateSchema>;
export type UpdateRateInput = z.infer<typeof updateRateSchema>;
export type UpdateCostCategoryInput = z.infer<typeof updateCostCategorySchema>;
export type UpdateCostTypeInput = z.infer<typeof updateCostTypeSchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
export type ReorderTypesInput = z.infer<typeof reorderTypesSchema>;
