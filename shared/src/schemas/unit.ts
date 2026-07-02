import { z } from 'zod';

export const createUnitSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  sortOrder: z.number().int().default(0),
  // Синонимы (варианты записи той же единицы): м²/кв.м, шт./штука и т.п.
  synonyms: z.array(z.string()).default([]),
});

export const updateUnitSchema = createUnitSchema.partial();

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
