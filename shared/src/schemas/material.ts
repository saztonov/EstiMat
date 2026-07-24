import { z } from 'zod';

export const createMaterialGroupSchema = z.object({
  name: z.string().min(1, 'Название обязательно').max(300),
  parentId: z.string().uuid().nullable().optional(),
  code: z.string().max(50).optional(),
});

export const createMaterialSchema = z.object({
  // Лимит 500: в справочнике есть длинные наименования (до ~350 симв.) — 300 обрезало бы их.
  name: z.string().min(1, 'Название обязательно').max(500),
  groupId: z.string().uuid().nullable().optional(),
  unit: z.string().min(1, 'Единица измерения обязательна').max(50),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной').default(0),
  description: z.string().max(2000).nullable().optional(),
  attributes: z.record(z.unknown())
    .refine((v) => Object.keys(v).length <= 100, 'Слишком много атрибутов')
    .optional(),
});

export const updateMaterialSchema = createMaterialSchema.partial();

// Отметка «проверенный материал» (курирование каталога) — тоггл is_verified.
export const setMaterialVerifiedSchema = z.object({
  verified: z.boolean(),
});

export type CreateMaterialGroupInput = z.infer<typeof createMaterialGroupSchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
export type SetMaterialVerifiedInput = z.infer<typeof setMaterialVerifiedSchema>;
