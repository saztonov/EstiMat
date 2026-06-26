/**
 * Маршрутизация LLM-вызовов по выбранной модели. Выбор хранится квалифицированно
 * провайдером: 'lmstudio:<id>' или 'openrouter:<id>'. Голый id без префикса трактуется
 * как openrouter (обратная совместимость со старыми настройками).
 *
 * OpenRouter (или прокси proxy_llm): адрес/ключ из env (config.ai).
 * LM Studio: адрес из БД (app_settings.lm_studio_base_url) → fallback env; токен — только env.
 */
import type { Pool } from 'pg';
import { config } from '../../config.js';

export type LlmProvider = 'openrouter' | 'lmstudio';

const LM_PREFIX = 'lmstudio:';
const OR_PREFIX = 'openrouter:';

export interface LlmRuntime {
  /** Действующий адрес LM Studio (БД → env). */
  lmBaseUrl: string;
  /** Токен LM Studio (только env). */
  lmToken: string;
  lmMaxTokens: number;
}

export interface ResolvedEndpoint {
  provider: LlmProvider;
  /** «Голый» id модели для тела запроса (без префикса провайдера). */
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Готов к вызову: есть адрес и ключ. */
  enabled: boolean;
  isLmStudio: boolean;
  /** Лимит токенов ответа (задаётся для LM Studio). */
  maxTokens?: number;
}

/** Разобрать квалифицированный выбор модели на провайдера и «голый» id. */
export function parseQualifiedModel(qualified: string): { provider: LlmProvider; model: string } {
  const v = (qualified || '').trim();
  if (v.startsWith(LM_PREFIX)) return { provider: 'lmstudio', model: v.slice(LM_PREFIX.length) };
  if (v.startsWith(OR_PREFIX)) return { provider: 'openrouter', model: v.slice(OR_PREFIX.length) };
  return { provider: 'openrouter', model: v };
}

/** Прочитать рантайм-настройки LM Studio (адрес из БД → env, токен из env). */
export async function loadLlmRuntime(pool: Pool): Promise<LlmRuntime> {
  const r = await pool.query(`SELECT value FROM app_settings WHERE key = 'lm_studio_base_url'`);
  const dbUrl = r.rows[0]?.value;
  const lmBaseUrl =
    typeof dbUrl === 'string' && dbUrl.trim() ? dbUrl.trim().replace(/\/+$/, '') : config.lmstudio.baseUrl;
  return { lmBaseUrl, lmToken: config.lmstudio.apiKey, lmMaxTokens: config.lmstudio.maxTokens };
}

/** Выбрать эндпоинт под выбранную (квалифицированную) модель. */
export function resolveLlmEndpoint(qualifiedModel: string, rt: LlmRuntime): ResolvedEndpoint {
  const { provider, model } = parseQualifiedModel(qualifiedModel);
  if (provider === 'lmstudio') {
    return {
      provider,
      model,
      baseUrl: rt.lmBaseUrl,
      apiKey: rt.lmToken,
      enabled: Boolean(rt.lmBaseUrl && rt.lmToken),
      isLmStudio: true,
      maxTokens: rt.lmMaxTokens,
    };
  }
  return {
    provider: 'openrouter',
    // «OpenRouter (прокси)» хранится как 'openrouter:' без id — модель задаёт прокси,
    // поэтому подставляем дефолт из env (для прямого OpenRouter в dev — рабочее значение).
    model: model || config.ai.model,
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    enabled: config.ai.enabled,
    isLmStudio: false,
  };
}
