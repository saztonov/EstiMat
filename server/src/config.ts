import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing env variable: ${key}`);
  return value;
}

export const config = {
  port: Number(env('PORT', '3000')),
  nodeEnv: env('NODE_ENV', 'development'),
  isProduction: env('NODE_ENV', 'development') === 'production',

  db: {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '5432')),
    database: env('DB_NAME', 'estimat'),
    user: env('DB_USER', 'estimat'),
    password: env('DB_PASSWORD', 'estimat_secret'),
    ssl: process.env.DB_SSL === 'true',
    // Размер пула задаётся явно (§7): при нескольких порталах на одной VPS
    // connection budget Managed PostgreSQL считается до добавления портала.
    poolMax: Number(env('DB_POOL_MAX', '20')),
    // Таймауты, чтобы одна зависшая тяжёлая выборка не держала соединение бесконечно и не
    // истощала пул. statement_timeout ограничивает КАЖДЫЙ отдельный statement (не транзакцию),
    // поэтому не рвёт нормальные пути записи; тяжёлые единичные операции при нужде поднимают
    // лимит локально через SET LOCAL. Прод накатывает миграции отдельным контейнером `migrate`
    // (свой клиент без этих лимитов) — CREATE INDEX не попадает под statement_timeout.
    statementTimeoutMs: Number(env('DB_STATEMENT_TIMEOUT_MS', '15000')),
    lockTimeoutMs: Number(env('DB_LOCK_TIMEOUT_MS', '3000')),
    idleTimeoutMs: Number(env('DB_IDLE_TIMEOUT_MS', '30000')),
    connectionTimeoutMs: Number(env('DB_CONNECTION_TIMEOUT_MS', '5000')),
  },

  jwt: {
    secret: env('JWT_SECRET', 'dev-jwt-secret-change-in-production-32ch'),
    refreshSecret: env('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-prod-32ch'),
    accessTtl: 15 * 60,       // 15 minutes in seconds
    refreshTtl: 7 * 24 * 3600, // 7 days in seconds
  },

  cors: {
    origin: env('CORS_ORIGIN', 'http://localhost:5173'),
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'ru-central-1',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    bucket: process.env.S3_BUCKET || 'estimat-files',
    // Хранилище файлов включено, когда заданы endpoint, ключи и bucket.
    // Иначе загрузки падают на локальный диск (только для dev).
    get enabled(): boolean {
      return Boolean(this.endpoint && this.accessKey && this.secretKey && this.bucket);
    },
  },

  // Портал РД (RDLOCAL): Supabase PostgREST + Cloudflare R2, только чтение.
  // Все переменные необязательны — без них секция РД показывает «не настроено».
  rd: {
    supabaseUrl: (process.env.RD_SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseKey: process.env.RD_SUPABASE_KEY || '',
    r2: {
      endpoint: process.env.RD_R2_ENDPOINT || '',
      accessKeyId: process.env.RD_R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.RD_R2_SECRET_ACCESS_KEY || '',
      bucket: process.env.RD_R2_BUCKET || '',
    },
    get enabled(): boolean {
      return Boolean(
        this.supabaseUrl &&
          this.supabaseKey &&
          this.r2.endpoint &&
          this.r2.accessKeyId &&
          this.r2.secretAccessKey &&
          this.r2.bucket,
      );
    },
  },

  // Встроенный ИИ-извлекатель (фаза 2): OpenRouter с дешёвой моделью.
  // Без ключа POST /api/ai/jobs только создаёт задание — его выполняет skill.
  ai: {
    apiKey: process.env.AI_OPENROUTER_API_KEY || '',
    model: process.env.AI_OPENROUTER_MODEL || 'google/gemini-2.5-flash',
    baseUrl: process.env.AI_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    get enabled(): boolean {
      return Boolean(this.apiKey);
    },
  },

  // Собственный сервер моделей LM Studio (OpenAI-совместимый). Используется, когда
  // выбранная модель помечена провайдером lmstudio (см. lib/llm/endpoint.ts).
  // Адрес можно переопределить в Администрировании (app_settings.lm_studio_base_url);
  // токен — ТОЛЬКО из env (секрет, в БД/логи не попадает). baseUrl включает путь /v1.
  lmstudio: {
    // fallback-адрес; БД переопределяет. Хост из него — базовый allowlist для адреса из БД.
    baseUrl: (process.env.LMSTUDIO_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.LMSTUDIO_API_KEY || '',
    maxTokens: Number(process.env.LMSTUDIO_MAX_TOKENS || '8192'),
    // У Qwen параллелизм 1 — ограничиваем одновременные тяжёлые вызовы.
    maxConcurrency: Number(process.env.LMSTUDIO_MAX_CONCURRENCY || '1'),
    timeoutMs: Number(process.env.LMSTUDIO_TIMEOUT_MS || '120000'),
    // Доп. разрешённые хосты для адреса из БД (защита от SSRF/утечки токена).
    allowedHosts: (process.env.LMSTUDIO_ALLOWED_HOSTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    get tokenConfigured(): boolean {
      return Boolean(this.apiKey);
    },
  },

  // Интеграция с BillHub (система заявок на оплату по РП). EstiMat ИНИЦИИРУЕТ создание заявки
  // на оплату (исходящее направление); токен — СЕКРЕТ, только из env. Пустой baseUrl/token =
  // «не настроено» (валидное состояние). syncEnabled — отдельный kill-switch: наличие
  // credentials само по себе НЕ включает отправку (безопасный поэтапный rollout).
  billhub: {
    baseUrl: (process.env.BILLHUB_BASE_URL || '').replace(/\/+$/, ''),
    apiToken: process.env.BILLHUB_API_TOKEN || '',
    timeoutMs: Number(process.env.BILLHUB_TIMEOUT_MS || '15000'),
    syncEnabled: process.env.BILLHUB_SYNC_ENABLED === 'true',
    get configured(): boolean {
      return Boolean(this.baseUrl && this.apiToken);
    },
    // Отправляем команды в BillHub только когда и настроено, и включено рубильником.
    get outboundEnabled(): boolean {
      return this.configured && this.syncEnabled;
    },
  },

  // Приём ВХОДЯЩИХ событий от BillHub (обновление статусов заявок на оплату). Ключ — СЕКРЕТ,
  // проверяется в middleware/authenticateService по заголовку Authorization: Api-Key.
  integration: {
    apiKey: process.env.INTEGRATION_API_KEY || '',
    get enabled(): boolean {
      return Boolean(this.apiKey);
    },
  },

  // Интеграция с PayHub (документооборот): EstiMat создаёт «РП» как исходящее письмо через
  // внешний API PayHub /api/external/v1 (Bearer-токен — СЕКРЕТ, только из env). Пустой
  // baseUrl/token = «не настроено» (валидное состояние; «Отправить РП» вернёт понятную ошибку).
  payhub: {
    baseUrl: (process.env.PAYHUB_BASE_URL || '').replace(/\/+$/, ''),
    apiToken: process.env.PAYHUB_API_TOKEN || '',
    timeoutMs: Number(process.env.PAYHUB_TIMEOUT_MS || '15000'),
    get configured(): boolean {
      return Boolean(this.baseUrl && this.apiToken);
    },
  },

  // Интеграция с тендерным порталом СУ-10 (закупочные лоты → площадка). EstiMat создаёт тендер
  // через внешний API /api/external/v1 (Bearer-токен — СЕКРЕТ, только из env) и опрашивает
  // результаты. Пустой baseUrl/token = «не настроено». syncEnabled — отдельный kill-switch:
  // наличие credentials не включает отправку/опрос (безопасный поэтапный rollout).
  tender: {
    baseUrl: (process.env.TENDER_BASE_URL || '').replace(/\/+$/, ''),
    apiToken: process.env.TENDER_API_TOKEN || '',
    timeoutMs: Number(process.env.TENDER_TIMEOUT_MS || '15000'),
    syncEnabled: process.env.TENDER_SYNC_ENABLED === 'true',
    get configured(): boolean {
      return Boolean(this.baseUrl && this.apiToken);
    },
    // Обращаемся к порталу (создание тендера, опрос) только когда и настроено, и включено рубильником.
    get outboundEnabled(): boolean {
      return this.configured && this.syncEnabled;
    },
  },
} as const;
