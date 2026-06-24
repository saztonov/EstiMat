// При раздельных доменах (app.* / api.*) фронт обращается к API по абсолютному
// origin из VITE_API_URL (задаётся при сборке). В dev переменная пуста — работает
// относительный путь через прокси Vite.
const BASE_URL = `${import.meta.env.VITE_API_URL ?? ''}/api`;

// Абсолютный URL для ассета, который отдаёт наш API (обложки проектов и пр.).
// Серверные ссылки приходят относительными (вида /api/...) — префиксуем их origin'ом
// API так же, как обычные запросы; внешние/легаси-URL отдаём без изменений.
export function assetUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  return src.startsWith('/api/') ? `${import.meta.env.VITE_API_URL ?? ''}${src}` : src;
}

// Таймаут запроса по умолчанию. При латентной/нестабильной сети (например, доступ
// через удалённый рабочий стол) без него fetch висит до браузерного лимита (~2 мин)
// без какого-либо фидбэка — поэтому обрываем сами и показываем понятное сообщение.
const DEFAULT_TIMEOUT_MS = 20_000;

let refreshPromise: Promise<{ ok: boolean; expiresAt: number }> | null = null;

interface FetchOptions {
  skipAuthRedirect?: boolean;
  // Не выполнять авто-refresh/redirect при 401 (для эндпоинтов /auth/login,
  // /auth/register): 401 там означает «неверные данные», а не истёкшую сессию,
  // и должен дойти до вызывающего кода как обычная ошибка.
  skipAuthRefresh?: boolean;
  timeoutMs?: number;
}

// Ошибка API с HTTP-статусом и уже подготовленным понятным текстом для пользователя.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function doRefresh(): Promise<{ ok: boolean; expiresAt: number }> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return { ok: false, expiresAt: 0 };
    const data = await res.json();
    return { ok: true, expiresAt: data.accessTokenExpiresAt };
  } catch {
    return { ok: false, expiresAt: 0 };
  }
}

function refreshAccessToken(): Promise<{ ok: boolean; expiresAt: number }> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function safeReturnUrl(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  return '/';
}

function redirectToLogin() {
  const returnUrl = safeReturnUrl(window.location.pathname + window.location.search);
  window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {},
  fetchOpts?: FetchOptions,
  isRetry = false,
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] ??= 'application/json';
  }

  const controller = new AbortController();
  const timeoutMs = fetchOpts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${url}`, {
      ...options,
      credentials: 'include',
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    // Обрыв по таймауту (мы сами вызвали abort) либо сетевая ошибка fetch.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'Сервер не отвечает. Проверьте соединение и попробуйте ещё раз.');
    }
    throw new ApiError(0, 'Не удалось соединиться с сервером. Проверьте интернет-соединение.');
  } finally {
    clearTimeout(timeoutId);
  }

  // 401 на /auth/login и /auth/register означает «неверные данные», а не истёкшую
  // сессию: авто-refresh бессмыслен, а redirect перезагружает страницу и стирает форму.
  if (res.status === 401 && !isRetry && !fetchOpts?.skipAuthRefresh) {
    const result = await refreshAccessToken();
    if (result.ok) {
      return apiFetch(url, options, fetchOpts, true);
    }
    if (!fetchOpts?.skipAuthRedirect) {
      redirectToLogin();
    }
    throw new ApiError(401, 'Сессия истекла. Войдите снова.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const serverError = body?.error as string | undefined;
    if (res.status === 429) {
      throw new ApiError(429, 'Слишком много попыток входа. Подождите минуту и попробуйте снова.');
    }
    if (res.status >= 500) {
      throw new ApiError(res.status, 'Ошибка сервера. Попробуйте позже.');
    }
    // Прочие 4xx: серверный текст уже на русском и осмысленный.
    throw new ApiError(res.status, serverError || `HTTP ${res.status}`);
  }

  return res.json();
}

// Convenience methods
export const api = {
  get: <T = unknown>(url: string, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'GET' }, opts),

  post: <T = unknown>(url: string, body?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, opts),

  put: <T = unknown>(url: string, body?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }, opts),

  patch: <T = unknown>(url: string, body?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }, opts),

  delete: <T = unknown>(url: string, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'DELETE' }, opts),

  upload: <T = unknown>(url: string, formData: FormData, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'POST', body: formData }, opts),
};
