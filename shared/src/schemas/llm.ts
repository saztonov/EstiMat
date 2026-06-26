import { z } from 'zod';

// Подключение к серверу моделей LM Studio (OpenAI-совместимый API).
// Адрес хранится в БД (app_settings.lm_studio_base_url), токен — только в env.
// Эти типы обслуживает роут /api/llm (раздел «Сервер моделей» в Администрировании);
// в общие AppSettings они НЕ входят.

/** Откуда взят действующий baseUrl. */
export type LlmBaseUrlSource = 'db' | 'env' | 'none';

/** Сведения о подключении к серверу моделей (без токена). */
export interface LlmConnection {
  /** Действующий адрес (БД → env). Включает путь /v1. */
  baseUrl: string;
  baseUrlSource: LlmBaseUrlSource;
  /** Токен задан в env (LMSTUDIO_API_KEY). Значение токена не передаётся. */
  tokenConfigured: boolean;
  /** Готов к вызовам: есть и адрес, и токен. */
  enabled: boolean;
  /** Кэш id моделей последнего успешного обновления каталога (для выбора в UI). */
  models: string[];
}

/** Карточка модели из каталога. Поля опциональны — заполняются, только если сервер их отдал. */
export interface LlmModelInfo {
  id: string;
  /** Тип/назначение, если сервер сообщил (llm, embeddings, vlm, …). */
  type?: string;
  /** Максимальная длина контекста, если известна. */
  contextLength?: number;
  /** Состояние загрузки на сервере, если известно (loaded/not-loaded). */
  state?: string;
  /** Издатель/владелец, если сообщён. */
  publisher?: string;
}

/** Ответ обновления каталога: список моделей + достижимость сервера. */
export interface LlmModelsResponse {
  data: LlmModelInfo[];
  reachable: boolean;
  /** Понятный текст ошибки, если сервер недоступен/токен неверный. */
  error?: string;
}

export interface LlmConnectionResponse {
  data: LlmConnection;
}

// Адрес сервера: валидный http(s)-URL; доп. ограничения (https-only, allowlist хостов)
// проверяет сервер (assertAllowedLmUrl) — здесь только базовая форма.
export const updateLlmConnectionSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url('Некорректный URL')
    .refine((u) => /^https?:\/\//i.test(u), 'Адрес должен начинаться с http(s)://'),
});

export type UpdateLlmConnectionInput = z.infer<typeof updateLlmConnectionSchema>;
