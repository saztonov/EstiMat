/**
 * Защита адреса сервера моделей LM Studio. Адрес правится администратором и хранится
 * в БД, а серверный fetch отправляет на него env-токен (LMSTUDIO_API_KEY) — поэтому
 * произвольный URL = риск SSRF и утечки секрета. Проверяем форму, схему и хост по
 * allowlist (хост из env LMSTUDIO_BASE_URL + LMSTUDIO_ALLOWED_HOSTS). Применять и при
 * сохранении адреса, и перед каждым серверным запросом к LM Studio.
 */
import { config } from '../../config.js';

export class LmUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LmUrlError';
  }
}

function hostnameOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function isLinkLocal(host: string): boolean {
  return host.startsWith('169.254.') || host.startsWith('fe80:');
}

/** Разрешённые хосты: из env-адреса + LMSTUDIO_ALLOWED_HOSTS. */
function allowedHosts(): string[] {
  const fromEnv = hostnameOf(config.lmstudio.baseUrl);
  return [...(fromEnv ? [fromEnv] : []), ...config.lmstudio.allowedHosts.map((h) => h.toLowerCase())];
}

/**
 * Проверяет адрес LM Studio и возвращает нормализованный (без хвостовых «/»).
 * Бросает LmUrlError с понятным текстом при нарушении.
 */
export function assertAllowedLmUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new LmUrlError('Некорректный URL');
  }

  if (url.username || url.password) {
    throw new LmUrlError('URL не должен содержать логин/пароль');
  }

  const host = url.hostname.toLowerCase();
  const isHttps = url.protocol === 'https:';
  const isHttp = url.protocol === 'http:';
  if (!isHttps && !isHttp) {
    throw new LmUrlError('Поддерживается только http(s)');
  }
  // http допустим только для localhost в dev.
  if (isHttp && !(isLoopback(host) && !config.isProduction)) {
    throw new LmUrlError('Требуется https (http разрешён только для localhost в dev)');
  }

  const allow = allowedHosts();
  if (allow.length > 0) {
    if (!allow.includes(host)) {
      throw new LmUrlError(`Хост «${host}» не в списке разрешённых (LMSTUDIO_BASE_URL/LMSTUDIO_ALLOWED_HOSTS)`);
    }
    // Хост явно разрешён администратором — приватные диапазоны допустимы.
    return raw.trim().replace(/\/+$/, '');
  }

  // Allowlist не задан.
  if (config.isProduction) {
    throw new LmUrlError('В проде задайте LMSTUDIO_BASE_URL или LMSTUDIO_ALLOWED_HOSTS');
  }
  if (isLinkLocal(host)) {
    throw new LmUrlError('Link-local адреса запрещены');
  }
  // dev без allowlist: разрешаем (включая loopback/LAN для локального LM Studio).
  return raw.trim().replace(/\/+$/, '');
}
