/**
 * HTTP-клиент внешнего API BillHub (заявки на оплату по РП). EstiMat — инициатор:
 * создаёт заявку на оплату (import-session → confirm files → submit) и читает справочники.
 * Токен (config.billhub.apiToken) — СЕКРЕТ, уходит в заголовке Authorization: Api-Key; в логи
 * не пишем. Базовый URL берётся из env (доверенный источник), но всё равно проверяется
 * (https в проде, без логина/пароля) — см. assertBillhubBaseUrl.
 *
 * Контракт (Часть B спецификации): все пути под /api/external/v1.
 * Реализация стороны BillHub выполняется отдельно; при выключенном рубильнике клиент не
 * вызывается (команды копятся в integration_outbox со статусом waiting_config).
 */
import { config } from '../../config.js';

export class BillhubError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  /** true — ошибка временная (сеть/5xx/429), команду стоит повторить позже. */
  readonly retryable: boolean;
  constructor(message: string, httpStatus: number, code: string, retryable: boolean) {
    super(message);
    this.name = 'BillhubError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.retryable = retryable;
  }
}

const API_PREFIX = '/api/external/v1';

/** Проверка базового адреса BillHub: только http(s), без кредов, https в проде. */
export function assertBillhubBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BillhubError('Некорректный BILLHUB_BASE_URL', 0, 'bad_config', false);
  }
  if (url.username || url.password) {
    throw new BillhubError('BILLHUB_BASE_URL не должен содержать логин/пароль', 0, 'bad_config', false);
  }
  const isHttps = url.protocol === 'https:';
  const isHttp = url.protocol === 'http:';
  if (!isHttps && !isHttp) {
    throw new BillhubError('BILLHUB_BASE_URL: только http(s)', 0, 'bad_config', false);
  }
  if (isHttp && config.isProduction) {
    throw new BillhubError('BILLHUB_BASE_URL: в проде требуется https', 0, 'bad_config', false);
  }
  return raw.trim().replace(/\/+$/, '');
}

type Json = Record<string, unknown>;

/** Низкоуровневый вызов BillHub API. redirect:'error' — не следуем за редиректами (SSRF). */
async function call<T = Json>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = assertBillhubBaseUrl(config.billhub.baseUrl);
  const res = await fetch(`${base}${API_PREFIX}${path}`, {
    method,
    redirect: 'error',
    headers: {
      Authorization: `Api-Key ${config.billhub.apiToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.billhub.timeoutMs),
  }).catch((e) => {
    // Сетевая ошибка/таймаут — временная, повторяемая.
    throw new BillhubError(`BillHub недоступен: ${(e as Error).message}`, 0, 'network', true);
  });

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let code = 'http_error';
  let message = `BillHub ответил ${res.status}`;
  try {
    const err = (await res.json()) as { error?: { code?: string; message?: string } | string };
    if (err && typeof err.error === 'object') {
      code = err.error.code ?? code;
      message = err.error.message ?? message;
    } else if (typeof err.error === 'string') {
      message = err.error;
    }
  } catch {
    /* тело не JSON — оставляем дефолт */
  }
  // 409 idempotency_conflict / прочие 4xx — постоянные; 429/5xx — временные.
  const retryable = res.status === 429 || res.status >= 500;
  throw new BillhubError(message, res.status, code, retryable);
}

/** GET с ретраями для временных ошибок (идемпотентно). */
async function getWithRetry<T = Json>(path: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await call<T>('GET', path);
    } catch (e) {
      lastErr = e;
      if (!(e instanceof BillhubError) || !e.retryable) throw e;
      // короткая задержка перед повтором
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

// ---- Справочники (Часть B2) ----
export interface BhSupplier { id: string; name: string; inn: string | null; securityStatus?: string | null }
export interface BhShippingOption { id: string; value: string }
export interface BhDocumentType { id: string; name: string; category?: string }

export const billhub = {
  listSuppliers: () => getWithRetry<{ data: BhSupplier[] }>('/references/suppliers'),
  listShipping: () => getWithRetry<{ data: BhShippingOption[] }>('/references/shipping-options'),
  listDocumentTypes: () => getWithRetry<{ data: BhDocumentType[] }>('/references/document-types'),

  // ---- Создание заявки (Часть B3): import-session → confirm files → submit ----
  /** Идемпотентно по externalRef: повтор с тем же телом вернёт исходный importId. */
  createImportSession: (payload: {
    externalRef: string;
    payloadHash: string;
    request: Json;
  }) => call<{ importId: string; replay?: boolean }>('POST', '/payment-requests/import', payload),

  requestFileUploadUrl: (importId: string, body: { fileName: string; contentType: string }) =>
    call<{ uploadUrl: string; fileKey: string }>('POST', `/payment-requests/import/${importId}/files/upload-url`, body),

  confirmImportFile: (importId: string, body: Json) =>
    call<{ fileId: string }>('POST', `/payment-requests/import/${importId}/files/confirm`, body),

  submitImport: (importId: string) =>
    call<{ requestId: string; number: string; url?: string; aggregateVersion: number; replay?: boolean }>(
      'POST',
      `/payment-requests/import/${importId}/submit`,
    ),

  // ---- Reconciliation (Часть B6) ----
  getSnapshotByRef: (externalRef: string) =>
    getWithRetry<{ data: Json }>(`/payment-requests/by-ref/${encodeURIComponent(externalRef)}`),

  /** PUT байтов файла напрямую в presigned-URL (S3 BillHub); вне Api-Key. */
  async putFileBytes(uploadUrl: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      redirect: 'error',
      headers: { 'Content-Type': contentType },
      body: bytes,
      signal: AbortSignal.timeout(config.billhub.timeoutMs),
    }).catch((e) => {
      throw new BillhubError(`Загрузка файла в BillHub не удалась: ${(e as Error).message}`, 0, 'network', true);
    });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new BillhubError(`S3 BillHub ответил ${res.status}`, res.status, 's3_error', retryable);
    }
  },
};
