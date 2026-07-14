import { z } from 'zod';

// Справочник «Закупки»: замена набора ответственных за категорию работ.
// userIds ОБЯЗАТЕЛЕН (без .default([])) — отсутствие поля не должно молча очищать назначения;
// пустой массив [] — явная очистка (снять всех ответственных с категории).
export const setCategoryResponsiblesSchema = z.object({
  userIds: z.array(z.string().uuid()),
});
export type SetCategoryResponsiblesInput = z.infer<typeof setCategoryResponsiblesSchema>;
