import { z } from 'zod';
import { MATERIAL_REQUEST_TYPES } from '../constants/statuses.js';

// Одна строка заявки на материал. Идентификация материала — тем же ключом свёртки,
// что клиент строит в aggregateMaterials (id:<material_id>|<ед> либо txt:<name>|<ед>),
// плюс cost_type_id вида работ (один материал в разных видах работ = разные строки свода).
export const materialRequestLineSchema = z.object({
  costTypeId: z.string().uuid().nullable(),
  aggKey: z.string().min(1),
  materialId: z.string().uuid().nullable(),
  name: z.string().min(1),
  unit: z.string(),
  quantity: z.number().positive(),
});

export const createMaterialRequestSchema = z.object({
  estimateId: z.string().uuid(),
  // Тип (маршрут) заявки выбирается подрядчиком осознанно — без значения по умолчанию.
  requestType: z.enum(MATERIAL_REQUEST_TYPES),
  lines: z.array(materialRequestLineSchema).min(1, 'Пустая заявка'),
});

export type MaterialRequestLineInput = z.infer<typeof materialRequestLineSchema>;
export type CreateMaterialRequestInput = z.infer<typeof createMaterialRequestSchema>;
