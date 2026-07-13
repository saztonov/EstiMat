import { config } from './config.js';

// Production startup checks (корп. стандарт §25): сервис обязан упасть на старте,
// если критичная настройка отсутствует, небезопасна или осталась dev-значением.
// В dev/test проверки не выполняются.

const INSECURE_JWT_VALUES = new Set([
  'dev-jwt-secret-change-in-production-32ch',
  'dev-refresh-secret-change-in-prod-32ch',
  'change-me-to-random-string-at-least-32-chars',
  'change-me-to-another-random-string-32-chars',
]);

export function runStartupChecks(): void {
  if (!config.isProduction) return;

  const errors: string[] = [];

  // JWT-секреты: не dev-значения, не короче 32 символов, различаются между собой.
  const jwtSecrets: ReadonlyArray<readonly [string, string]> = [
    ['JWT_SECRET', config.jwt.secret],
    ['JWT_REFRESH_SECRET', config.jwt.refreshSecret],
  ];
  for (const [name, value] of jwtSecrets) {
    if (INSECURE_JWT_VALUES.has(value)) {
      errors.push(`${name}: используется небезопасное значение по умолчанию`);
    }
    if (value.length < 32) {
      errors.push(`${name}: длина меньше 32 символов`);
    }
  }
  if (config.jwt.secret === config.jwt.refreshSecret) {
    errors.push('JWT_SECRET и JWT_REFRESH_SECRET должны различаться');
  }

  // База данных: не dev-пароль, обязательный TLS (Yandex Managed PostgreSQL).
  if (config.db.password === 'estimat_secret') {
    errors.push('DB_PASSWORD: dev-пароль недопустим в production');
  }
  if (!config.db.ssl) {
    errors.push('DB_SSL должен быть true (Managed PostgreSQL требует TLS)');
  }

  // CORS: не должен указывать на localhost в production.
  if (/localhost|127\.0\.0\.1/.test(config.cors.origin)) {
    errors.push(`CORS_ORIGIN указывает на localhost: ${config.cors.origin}`);
  }

  // S3: хранение файлов обязательно сконфигурировано (§15, §25).
  if (!config.s3.enabled) {
    errors.push('S3 не сконфигурирован (нужны S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET)');
  }

  // BillHub: конфигурация либо полная (baseUrl + token), либо пустая. Частичная — ошибка.
  const bhBaseUrl = config.billhub.baseUrl;
  const bhToken = config.billhub.apiToken;
  if (Boolean(bhBaseUrl) !== Boolean(bhToken)) {
    errors.push('BillHub: задайте оба BILLHUB_BASE_URL и BILLHUB_API_TOKEN, либо ни одного');
  }
  if (bhBaseUrl && !/^https:\/\//.test(bhBaseUrl)) {
    errors.push('BILLHUB_BASE_URL должен использовать https в production');
  }
  // Рубильник отправки нельзя включить без полной конфигурации.
  if (config.billhub.syncEnabled && !config.billhub.configured) {
    errors.push('BILLHUB_SYNC_ENABLED=true требует BILLHUB_BASE_URL и BILLHUB_API_TOKEN');
  }

  // Ключ приёма событий BillHub: если задан — не короче 32 символов.
  if (config.integration.apiKey && config.integration.apiKey.length < 32) {
    errors.push('INTEGRATION_API_KEY: длина меньше 32 символов');
  }

  // Тендерный портал: конфигурация либо полная (baseUrl + token), либо пустая. Частичная — ошибка.
  const tBaseUrl = config.tender.baseUrl;
  const tToken = config.tender.apiToken;
  if (Boolean(tBaseUrl) !== Boolean(tToken)) {
    errors.push('Тендер: задайте оба TENDER_BASE_URL и TENDER_API_TOKEN, либо ни одного');
  }
  if (tBaseUrl && !/^https:\/\//.test(tBaseUrl)) {
    errors.push('TENDER_BASE_URL должен использовать https в production');
  }
  // Рубильник отправки нельзя включить без полной конфигурации.
  if (config.tender.syncEnabled && !(tBaseUrl && tToken)) {
    errors.push('TENDER_SYNC_ENABLED=true требует TENDER_BASE_URL и TENDER_API_TOKEN');
  }
  // Заглушка портала — только для dev.
  if (config.tender.mock) {
    errors.push('TENDER_MOCK=true недопустим в production (заглушка только для dev)');
  }

  if (errors.length > 0) {
    const message = ['Production startup checks failed:', ...errors.map((e) => `  - ${e}`)].join('\n');
    throw new Error(message);
  }
}
