import { z } from 'zod';
import { aiCatalogSourceSchema, type AiCatalogSource } from './ai.js';

// Глобальные настройки приложения (вкладка «Настройки» в администрировании).
export interface AppSettings {
  /** Показывать ли блок «Рабочая документация» в справочниках сметы */
  rdSectionEnabled: boolean;
  /** Источник справочника для ИИ-сопоставления извлечённых позиций */
  aiCatalogSource: AiCatalogSource;
  /** Список доступных LLM-моделей (id OpenRouter, напр. 'anthropic/claude-opus-4-8') */
  aiModels: string[];
  /** Модель по умолчанию для ИИ-извлечения из РД (должна быть из aiModels) */
  aiModelDefault: string;
  /** Модель по умолчанию для ИИ-ассистента в режиме чата (должна быть из aiModels) */
  aiChatModelDefault: string;
}

export const updateAppSettingsSchema = z.object({
  rdSectionEnabled: z.boolean().optional(),
  aiCatalogSource: aiCatalogSourceSchema.optional(),
  aiModels: z.array(z.string().min(1)).optional(),
  aiModelDefault: z.string().optional(),
  aiChatModelDefault: z.string().optional(),
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

export interface AppSettingsResponse {
  data: AppSettings;
}
