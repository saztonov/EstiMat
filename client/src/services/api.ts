const BASE_URL = '/api';

let refreshPromise: Promise<{ ok: boolean; expiresAt: number }> | null = null;

interface FetchOptions {
  skipAuthRedirect?: boolean;
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
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 401 && !isRetry) {
    const result = await refreshAccessToken();
    if (result.ok) {
      return apiFetch(url, options, fetchOpts, true);
    }
    if (!fetchOpts?.skipAuthRedirect) {
      redirectToLogin();
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Ошибка сервера' }));
    throw new Error(error.error || `HTTP ${res.status}`);
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

  delete: <T = unknown>(url: string, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'DELETE', headers: {} }, opts),

  upload: <T = unknown>(url: string, formData: FormData, opts?: FetchOptions) =>
    apiFetch<T>(url, { method: 'POST', body: formData, headers: {} }, opts),
};
