import { z } from 'zod';
import { aiCatalogSourceSchema, type AiCatalogSource } from './ai.js';

// Глобальные настройки приложения (вкладка «Настройки» в администрировании).
export interface AppSettings {
  /** Показывать ли блок «Рабочая документация» в справочниках сметы */
  rdSectionEnabled: boolean;
  /** Источник справочника для ИИ-сопоставления извлечённых позиций */
  aiCatalogSource: AiCatalogSource;
}

export const updateAppSettingsSchema = z.object({
  rdSectionEnabled: z.boolean().optional(),
  aiCatalogSource: aiCatalogSourceSchema.optional(),
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

export interface AppSettingsResponse {
  data: AppSettings;
}
