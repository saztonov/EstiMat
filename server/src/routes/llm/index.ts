import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { updateLlmConnectionSchema, type LlmConnection, type LlmModelInfo } from '@estimat/shared';
import { config } from '../../config.js';
import { assertAllowedLmUrl, LmUrlError } from '../../lib/llm/url-guard.js';

// Раздел «Сервер моделей» в Администрировании: подключение к LM Studio (OpenAI-совместимый
// API), живой каталог моделей. Адрес хранится в БД (lm_studio_base_url), токен — только env.
// Токен в ответы/логи НИКОГДА не попадает.

const KEY_BASE_URL = 'lm_studio_base_url';
const KEY_CATALOG = 'lm_studio_catalog';

export default async function llmRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
    const { rows } = await fastify.pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    return rows[0]?.value as T | undefined;
  }
  async function setSetting(key: string, value: unknown): Promise<void> {
    await fastify.pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }

  // Действующий адрес: БД → env. Источник нужен для UI-подсказки.
  async function effectiveBaseUrl(): Promise<{ baseUrl: string; source: 'db' | 'env' | 'none' }> {
    const db = await getSetting<string>(KEY_BASE_URL);
    if (typeof db === 'string' && db.trim()) return { baseUrl: db.trim().replace(/\/+$/, ''), source: 'db' };
    if (config.lmstudio.baseUrl) return { baseUrl: config.lmstudio.baseUrl, source: 'env' };
    return { baseUrl: '', source: 'none' };
  }

  async function cachedCatalog(): Promise<LlmModelInfo[]> {
    const c = await getSetting<LlmModelInfo[]>(KEY_CATALOG);
    return Array.isArray(c) ? c : [];
  }

  async function buildConnection(): Promise<LlmConnection> {
    const { baseUrl, source } = await effectiveBaseUrl();
    const tokenConfigured = config.lmstudio.tokenConfigured;
    const catalog = await cachedCatalog();
    return {
      baseUrl,
      baseUrlSource: source,
      tokenConfigured,
      enabled: Boolean(baseUrl && tokenConfigured),
      models: catalog.map((m) => m.id),
    };
  }

  // GET /api/llm/connection — параметры подключения (без токена) + кэш id каталога.
  // Доступно всем авторизованным: нужно SettingsPanel для списка моделей (как GET /settings).
  fastify.get('/connection', async () => {
    return { data: await buildConnection() };
  });

  // PUT /api/llm/connection — сохранить адрес; каталог сбрасываем (привязан к адресу).
  fastify.put('/connection', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = updateLlmConnectionSchema.parse(request.body);
    let normalized: string;
    try {
      normalized = assertAllowedLmUrl(body.baseUrl);
    } catch (err) {
      if (err instanceof LmUrlError) return reply.status(400).send({ error: err.message });
      throw err;
    }
    await setSetting(KEY_BASE_URL, normalized);
    await setSetting(KEY_CATALOG, []); // старый каталог нерелевантен новому серверу
    return { data: await buildConnection() };
  });

  // GET /api/llm/models — readonly: последний сохранённый каталог (любому авторизованному).
  fastify.get('/models', async () => {
    const data = await cachedCatalog();
    return { data, reachable: data.length > 0 };
  });

  // POST /api/llm/models/refresh — живой запрос к серверу, сохранение каталога.
  fastify.post('/models/refresh', { preHandler: [requireRole('admin')] }, async () => {
    const { baseUrl } = await effectiveBaseUrl();
    if (!baseUrl) return { data: [], reachable: false, error: 'Адрес сервера не задан' };
    if (!config.lmstudio.tokenConfigured) {
      return { data: [], reachable: false, error: 'Токен не задан (LMSTUDIO_API_KEY)' };
    }
    try {
      assertAllowedLmUrl(baseUrl);
    } catch (err) {
      return { data: [], reachable: false, error: err instanceof LmUrlError ? err.message : 'Недопустимый адрес' };
    }

    try {
      const models = await fetchCatalog(baseUrl, config.lmstudio.apiKey, config.lmstudio.timeoutMs);
      await setSetting(KEY_CATALOG, models);
      return { data: models, reachable: true };
    } catch (err) {
      fastify.log.warn({ err: String(err) }, 'lm studio models refresh failed'); // без токена
      const msg = err instanceof Error ? err.message : 'Сервер недоступен';
      return { data: await cachedCatalog(), reachable: false, error: msg };
    }
  });
}

async function fetchWithTimeout(url: string, token: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Живой каталог: /v1/models (источник истины) + обогащение из нативного /api/v0/models. */
async function fetchCatalog(baseUrl: string, token: string, timeoutMs: number): Promise<LlmModelInfo[]> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${baseUrl}/models`, token, timeoutMs);
  } catch {
    throw new Error('Сервер недоступен (таймаут или сетевая ошибка)');
  }
  if (res.status === 401) throw new Error('Неверный токен (401)');
  if (!res.ok) throw new Error(`Сервер вернул ${res.status}`);

  const body = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
  const base: LlmModelInfo[] = (body.data ?? [])
    .filter((m) => typeof m.id === 'string' && m.id)
    .map((m) => ({ id: m.id as string, publisher: typeof m.owned_by === 'string' ? m.owned_by : undefined }));

  // Best-effort: нативный LM Studio API даёт type/state/max_context_length.
  try {
    const origin = new URL(baseUrl).origin;
    const nat = await fetchWithTimeout(`${origin}/api/v0/models`, token, timeoutMs);
    if (nat.ok) {
      const nb = (await nat.json()) as {
        data?: Array<{ id?: string; type?: string; state?: string; max_context_length?: number; publisher?: string }>;
      };
      const byId = new Map((nb.data ?? []).filter((m) => m.id).map((m) => [m.id as string, m]));
      for (const info of base) {
        const ex = byId.get(info.id);
        if (ex) {
          info.type = typeof ex.type === 'string' ? ex.type : info.type;
          info.state = typeof ex.state === 'string' ? ex.state : info.state;
          info.contextLength = typeof ex.max_context_length === 'number' ? ex.max_context_length : info.contextLength;
          info.publisher = typeof ex.publisher === 'string' ? ex.publisher : info.publisher;
        }
      }
    }
  } catch {
    // нативный API недоступен — отдаём то, что есть из /v1/models
  }

  return base;
}
