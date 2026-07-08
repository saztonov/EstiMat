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

// Базовые поля расценки. Виды работ — many-to-many (массив costTypeIds), один из них
// помечается основным (primaryCostTypeId). Цена необязательна: пустое/None → 0
// (AntD InputNumber при очистке отдаёт null, поэтому нормализуем через preprocess).
const rateBaseSchema = z.object({
  costTypeIds: z.array(z.string().uuid()).min(1, 'Выберите хотя бы один вид работ'),
  primaryCostTypeId: z.string().uuid().optional(),
  name: z.string().min(1, 'Название обязательно'),
  code: z.string().optional(),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  price: z.preprocess(
    (v) => (v == null || v === '' ? 0 : v),
    z.number().min(0, 'Цена не может быть отрицательной'),
  ),
  description: z.string().optional(),
});

// Переходная совместимость: принимаем одиночный costTypeId и нормализуем в массив.
const withCostTypeCompat = (val: unknown): unknown => {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const v = val as Record<string, unknown>;
    if (v.costTypeIds == null && typeof v.costTypeId === 'string') {
      const { costTypeId, ...rest } = v;
      return { ...rest, costTypeIds: [costTypeId] };
    }
  }
  return val;
};

const hasUniqueTypes = (d: { costTypeIds?: string[] }): boolean =>
  !d.costTypeIds || new Set(d.costTypeIds).size === d.costTypeIds.length;
const primaryInSet = (d: { costTypeIds?: string[]; primaryCostTypeId?: string }): boolean =>
  !d.primaryCostTypeId || !!d.costTypeIds?.includes(d.primaryCostTypeId);

export const createRateSchema = z
  .preprocess(withCostTypeCompat, rateBaseSchema)
  .refine(hasUniqueTypes, { message: 'Виды работ не должны повторяться', path: ['costTypeIds'] })
  .refine(primaryInSet, {
    message: 'Основной вид должен входить в выбранные виды',
    path: ['primaryCostTypeId'],
  });

// Обновление: все поля опциональны. Если пришёл costTypeIds — связка пересобирается;
// если только primaryCostTypeId — меняется основной среди текущих связок (проверяет роут).
export const updateRateSchema = z
  .preprocess(withCostTypeCompat, rateBaseSchema.partial())
  .refine(hasUniqueTypes, { message: 'Виды работ не должны повторяться', path: ['costTypeIds'] })
  .refine(primaryInSet, {
    message: 'Основной вид должен входить в выбранные виды',
    path: ['primaryCostTypeId'],
  });

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
