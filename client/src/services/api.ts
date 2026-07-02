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
// data/code несут тело ответа (например, при 409 — актуальная строка и code:'CONFLICT'),
// чтобы вызывающий код мог отреагировать на конфликт, не теряя черновик пользователя.
export class ApiError extends Error {
  status: number;
  data?: unknown;
  code?: string;
  constructor(status: number, message: string, opts?: { data?: unknown; code?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = opts?.data;
    this.code = opts?.code;
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

// Проактивный refresh (useAuthRefresh) должен ходить на тот же API-origin, что и остальной REST
// (${BASE_URL}), а не на относительный путь — иначе при раздельных доменах (app.*/api.*) запрос
// уходит в SPA-nginx и молча падает. Переиспользуем общий дедуплицированный refreshAccessToken.
export function refreshSession(): Promise<{ ok: boolean; expiresAt: number }> {
  return refreshAccessToken();
}

function safeReturnUrl(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  return '/';
}

function redirectToLogin() {
  const returnUrl = safeReturnUrl(window.location.pathname + window.location.search);
  window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
}

// Ядро запроса с авто-refresh при 401 и понятными ошибками. Возвращает СЫРОЙ Response
// (тело не вычитано на успехе) — поверх строятся apiFetch (JSON) и download (Blob),
// чтобы не дублировать логику авторизации/повторов.
async function apiFetchRaw(
  url: string,
  options: RequestInit = {},
  fetchOpts?: FetchOptions,
  isRetry = false,
): Promise<Response> {
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
      return apiFetchRaw(url, options, fetchOpts, true);
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
    // Пробрасываем тело (data/code) — нужно для обработки 409 (OCC-конфликт).
    throw new ApiError(res.status, serverError || `HTTP ${res.status}`, {
      data: body?.data,
      code: body?.code as string | undefined,
    });
  }

  return res;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {},
  fetchOpts?: FetchOptions,
): Promise<T> {
  const res = await apiFetchRaw(url, options, fetchOpts);
  return res.json() as Promise<T>;
}

// Имя файла из заголовка Content-Disposition (RFC 5987 filename*=UTF-8'' или filename=).
function filenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1]); } catch { /* fallthrough */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1] ?? null;
}

// Скачать бинарный ответ (например .xlsx) как файл. Переиспользует авторизацию/refresh
// из apiFetchRaw; имя берёт из Content-Disposition, иначе fallbackName. Таймаут больше
// обычного — сервер может собирать файл несколько секунд.
async function downloadBlob(
  url: string,
  options: RequestInit,
  fallbackName: string,
  fetchOpts?: FetchOptions,
): Promise<void> {
  const res = await apiFetchRaw(url, options, { timeoutMs: 60_000, ...fetchOpts });
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
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

  // POST с телом → скачивание файла (blob) из ответа.
  download: (url: string, body?: unknown, fallbackName = 'download', opts?: FetchOptions) =>
    downloadBlob(
      url,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
      fallbackName,
      opts,
    ),
};
