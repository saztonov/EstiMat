import { z } from 'zod';

// Глобальные настройки приложения (вкладка «Настройки» в администрировании).
export interface AppSettings {
  /** Показывать ли блок «Рабочая документация» в справочниках сметы */
  rdSectionEnabled: boolean;
}

export const updateAppSettingsSchema = z.object({
  rdSectionEnabled: z.boolean().optional(),
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

export interface AppSettingsResponse {
  data: AppSettings;
}
