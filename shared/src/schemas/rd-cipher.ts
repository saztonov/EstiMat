import { z } from 'zod';

// Шифр рабочей документации (РД) объекта, напр. «133_23-ГК-ЭО1».
export const createRdCipherSchema = z.object({
  code: z.string().trim().min(1, 'Шифр обязателен').max(100, 'Шифр: до 100 символов'),
});

// PUT = частичное обновление.
export const updateRdCipherSchema = createRdCipherSchema.partial();

// Полная строка справочника (с id/timestamps).
export const rdCipherSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  code: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Назначение набора шифров РД виду работ в смете (REPLACE набора; мультивыбор).
export const setCostTypeCiphersSchema = z.object({
  cipherIds: z.array(z.string().uuid()).max(50, 'Слишком много шифров'),
});

export type CreateRdCipherInput = z.infer<typeof createRdCipherSchema>;
export type UpdateRdCipherInput = z.infer<typeof updateRdCipherSchema>;
export type RdCipher = z.infer<typeof rdCipherSchema>;
export type SetCostTypeCiphersInput = z.infer<typeof setCostTypeCiphersSchema>;
