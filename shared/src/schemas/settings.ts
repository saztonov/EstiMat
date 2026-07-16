import { z } from 'zod';
import { aiCatalogSourceSchema, type AiCatalogSource } from './ai.js';
import { groupingSettingsSchema, type GroupingSettings } from './material-grouping.js';

// Глобальные настройки приложения (вкладка «Настройки» в администрировании).
export interface AppSettings {
  /** Показывать ли блок «Рабочая документация» в справочниках сметы */
  rdSectionEnabled: boolean;
  /**
   * Источник справочника для ИИ. COMPAT-ONLY: значение сохраняется в БД, но на ИИ
   * больше не влияет — и чат, и РД-извлечение зафиксированы на legacy
   * (см. CHAT_CATALOG_MODE на сервере). Пользовательского управления нет.
   */
  aiCatalogSource: AiCatalogSource;
  /** Список доступных LLM-моделей OpenRouter (id, напр. 'anthropic/claude-opus-4-8') */
  aiModels: string[];
  /**
   * Модель по умолчанию для ИИ-извлечения из РД. Значение квалифицировано провайдером:
   * 'openrouter:<id>' или 'lmstudio:<id>' (голый id без префикса трактуется как openrouter).
   */
  aiModelDefault: string;
  /** Модель по умолчанию для ИИ-чата. Квалифицирована провайдером, см. aiModelDefault. */
  aiChatModelDefault: string;
  /** Режим Qwen (LM Studio) без рассуждений: добавлять /no_think в промпт. */
  aiQwenNoThink: boolean;
  /**
   * Границы групп для умной группировки материалов. Настройка общая для всех: результат один
   * на смету, поэтому уровни задаёт администратор, а не каждый пользователь у себя.
   * Изменение делает готовые результаты устаревшими — они пересчитаются при следующем открытии.
   */
  materialGroupingLevels: GroupingSettings;
}

export const updateAppSettingsSchema = z.object({
  rdSectionEnabled: z.boolean().optional(),
  aiCatalogSource: aiCatalogSourceSchema.optional(),
  aiModels: z.array(z.string().min(1)).optional(),
  aiModelDefault: z.string().optional(),
  aiChatModelDefault: z.string().optional(),
  aiQwenNoThink: z.boolean().optional(),
  materialGroupingLevels: groupingSettingsSchema.optional(),
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

export interface AppSettingsResponse {
  data: AppSettings;
}
