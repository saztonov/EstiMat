/**
 * HTTP-клиент внешнего тендерного портала СУ-10 (контракт billhub, /api/external/v1).
 * EstiMat ИНИЦИИРУЕТ создание тендера (лот → площадка) и опрашивает результаты. Токен
 * (config.tender.apiToken) — СЕКРЕТ, уходит в Authorization: Bearer; в логи не пишем.
 * Идемпотентность создания — по external_ref='estimat:lot:<orderId>' (портал возвращает
 * существующий тендер при повторе). Ответы валидируются zod-схемами на границе.
 */
import { config } from '../../config.js';
import { tenderSchema, tenderResultsSchema, type TenderDto, type TenderResultsDto } from '@estimat/shared';
import { TenderApiError } from './errors.js';
import { MockTenderClient } from './mock-client.js';

const API_PREFIX = '/api/external/v1';
const PING_TIMEOUT_MS = 5000;

export interface TenderItemInput {
  material: string;
  quantity: number;
  unit?: string | null;
  spec?: string | null;
}

export interface CreateTenderInput {
  title: string;
  external_ref: string;
  deadline_at?: string | null;
  items: TenderItemInput[];
  conditions?: { delivery?: string | null; payment?: string | null; deadline?: string | null };
}

/** Контракт клиента тендерного портала (реальный HTTP-клиент и mock-заглушка). */
export interface TenderClientLike {
  createTender(input: CreateTenderInput): Promise<TenderDto>;
  getTender(id: string): Promise<TenderDto>;
  getTenderResults(id: string): Promise<TenderResultsDto>;
  cancelTender(id: string): Promise<void>;
  ping(): Promise<boolean>;
}

/** Нормализация baseUrl: http(s)-origin без пути/кредов, https в проде. */
export function normalizeTenderBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new TenderApiError('Некорректный TENDER_BASE_URL', 0, 'bad_config', false);
  }
  if (url.username || url.password) {
    throw new TenderApiError('TENDER_BASE_URL не должен содержать логин/пароль', 0, 'bad_config', false);
  }
  const isHttps = url.protocol === 'https:';
  const isHttp = url.protocol === 'http:';
  if (!isHttps && !isHttp) throw new TenderApiError('TENDER_BASE_URL: только http(s)', 0, 'bad_config', false);
  if (isHttp && config.isProduction) {
    throw new TenderApiError('TENDER_BASE_URL: в проде требуется https', 0, 'bad_config', false);
  }
  if (url.pathname.replace(/\/+$/, '') !== '') {
    throw new TenderApiError('TENDER_BASE_URL должен быть origin без пути', 0, 'bad_config', false);
  }
  return url.origin;
}

export class TenderClient implements TenderClientLike {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; token: string; timeoutMs?: number }) {
    this.baseUrl = normalizeTenderBaseUrl(opts.baseUrl);
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? config.tender.timeoutMs;
  }

  /** Низкоуровневый вызов. redirect:'error' — против SSRF; токен в логи не пишем. */
  private async call<T = unknown>(
    method: string,
    path: string,
    opts: { body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${API_PREFIX}${path}`;
    const res = await fetch(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
    }).catch((e) => {
      throw new TenderApiError(`Тендерный портал недоступен: ${(e as Error).message}`, 0, 'network', true);
    });

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    let code = 'http_error';
    let message = `Портал ответил ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { code?: string; message?: string } | string };
      if (err && typeof err.error === 'object') {
        code = err.error.code ?? code;
        message = err.error.message ?? message;
      } else if (typeof err.error === 'string') {
        message = err.error;
      }
    } catch {
      /* тело не JSON */
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new TenderApiError(message, res.status, code, retryable);
  }

  private async getWithRetry<T>(path: string, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.call<T>('GET', path);
      } catch (e) {
        lastErr = e;
        if (!(e instanceof TenderApiError) || !e.retryable) throw e;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
    throw lastErr;
  }

  // Создание тендера идемпотентно по external_ref (мутация не повторяется воркером).
  async createTender(input: CreateTenderInput): Promise<TenderDto> {
    return tenderSchema.parse(await this.call('POST', '/tenders', { body: input }));
  }

  async getTender(id: string): Promise<TenderDto> {
    return tenderSchema.parse(await this.getWithRetry(`/tenders/${encodeURIComponent(id)}`));
  }

  async getTenderResults(id: string): Promise<TenderResultsDto> {
    return tenderResultsSchema.parse(await this.getWithRetry(`/tenders/${encodeURIComponent(id)}/results`));
  }

  async cancelTender(id: string): Promise<void> {
    await this.call<void>('POST', `/tenders/${encodeURIComponent(id)}/cancel`);
  }

  async ping(): Promise<boolean> {
    await this.call('GET', '/health', { timeoutMs: PING_TIMEOUT_MS });
    return true;
  }
}

/** Фабрика из config. null — интеграция не настроена (валидное состояние). */
export function getTenderClient(): TenderClientLike | null {
  if (config.tender.mock) return new MockTenderClient(); // dev-заглушка портала
  if (!config.tender.configured) return null;
  return new TenderClient({
    baseUrl: config.tender.baseUrl,
    token: config.tender.apiToken,
    timeoutMs: config.tender.timeoutMs,
  });
}
