import { z } from 'zod';

export const createMaterialGroupSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  parentId: z.string().uuid().nullable().optional(),
  code: z.string().optional(),
});

export const createMaterialSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  groupId: z.string().uuid().nullable().optional(),
  unit: z.string().min(1, 'Единица измерения обязательна'),
  description: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
});

export const updateMaterialSchema = createMaterialSchema.partial();

export type CreateMaterialGroupInput = z.infer<typeof createMaterialGroupSchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
