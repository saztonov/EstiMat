/**
 * HTTP-клиент внешнего API PayHub (/api/external/v1). EstiMat создаёт «РП» как исходящее
 * письмо PayHub. Токен (config.payhub.apiToken) — СЕКРЕТ, уходит в заголовке Authorization:
 * Bearer; в логи не пишем. baseUrl — origin без пути (валидируется).
 *
 * Идемпотентность создания письма — по external_ref = estimat:rp:<request_id> (lookup-before-create,
 * усыновление на 409). reg_number генерирует PayHub.
 */
import { config } from '../../config.js';
import { PayHubApiError } from './errors.js';

const API_PREFIX = '/api/external/v1';
const PING_TIMEOUT_MS = 5000;
const PUT_BINARY_TIMEOUT_MS = 600_000;
const MAX_ATTACHMENT_BYTES = 300 * 1024 * 1024;

export interface PayHubProject { id: number; code: string | null; name: string; is_active?: boolean }
export interface PayHubContractor { id: number; name: string; inn: string | null; is_payer?: boolean }
export interface PayHubLetterStatus { id: number; code: string; name: string }
export interface PayHubLetter {
  id: string;
  number?: string | null;
  reg_number?: string | null;
  letter_date?: string | null;
}
export interface PayHubShare { share_url?: string; qr_svg_data_url?: string }
export interface PayHubLetterCreated { letter: PayHubLetter; share?: PayHubShare }

export interface CreateLetterInput {
  project_id: number;
  direction: 'incoming' | 'outgoing';
  letter_date: string;
  subject?: string | null;
  content?: string | null;
  responsible_person_name?: string | null;
  sender_type?: string | null;
  sender_contractor_id?: number | null;
  recipient_type?: string | null;
  recipient_contractor_id?: number | null;
  external_ref?: string;
  ensure_share?: boolean;
}

export interface UpdateLetterInput {
  subject?: string | null;
  content?: string | null;
  responsible_person_name?: string | null;
  letter_date?: string | null;
}

export interface UploadFileInput {
  name: string;
  bytes: Buffer;
  mime_type?: string;
  description?: string;
}

/** Нормализация baseUrl PayHub: http(s)-origin без пути, https в проде. */
export function normalizePayhubBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PayHubApiError('Некорректный PAYHUB_BASE_URL', 0, 'bad_config', false);
  }
  if (url.username || url.password) {
    throw new PayHubApiError('PAYHUB_BASE_URL не должен содержать логин/пароль', 0, 'bad_config', false);
  }
  const isHttps = url.protocol === 'https:';
  const isHttp = url.protocol === 'http:';
  if (!isHttps && !isHttp) throw new PayHubApiError('PAYHUB_BASE_URL: только http(s)', 0, 'bad_config', false);
  if (isHttp && config.isProduction) {
    throw new PayHubApiError('PAYHUB_BASE_URL: в проде требуется https', 0, 'bad_config', false);
  }
  if (url.pathname.replace(/\/+$/, '') !== '') {
    throw new PayHubApiError('PAYHUB_BASE_URL должен быть origin без пути', 0, 'bad_config', false);
  }
  return url.origin;
}

function pickArray<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const k of keys) if (Array.isArray(rec[k])) return rec[k] as T[];
    const arrays = Object.values(rec).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as T[];
  }
  throw new PayHubApiError('PayHub: неожиданный формат ответа (ожидался массив)', 0, 'bad_response', false);
}

function unwrapLetter(payload: unknown): PayHubLetter {
  const rec = (payload ?? {}) as Record<string, unknown>;
  const letter = (rec.letter ?? rec) as PayHubLetter;
  if (!letter || typeof letter !== 'object' || letter.id === undefined) {
    throw new PayHubApiError('PayHub: неожиданный формат ответа (ожидалось письмо)', 0, 'bad_response', false);
  }
  return letter;
}

export class PayHubClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; token: string; timeoutMs?: number }) {
    this.baseUrl = normalizePayhubBaseUrl(opts.baseUrl);
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? config.payhub.timeoutMs;
  }

  /** Низкоуровневый вызов. redirect:'error' — против SSRF; токен в логи не пишем. */
  private async call<T = unknown>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, unknown>; timeoutMs?: number } = {},
  ): Promise<T> {
    let url = `${this.baseUrl}${API_PREFIX}${path}`;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== null) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
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
      throw new PayHubApiError(`PayHub недоступен: ${(e as Error).message}`, 0, 'network', true);
    });

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    let code = 'http_error';
    let message = `PayHub ответил ${res.status}`;
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
    throw new PayHubApiError(message, res.status, code, retryable);
  }

  private async getWithRetry<T>(path: string, query?: Record<string, unknown>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.call<T>('GET', path, { query });
      } catch (e) {
        lastErr = e;
        if (!(e instanceof PayHubApiError) || !e.retryable) throw e;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
    throw lastErr;
  }

  // ---- Справочники (scope catalog:read) ----
  listProjects = () => this.getWithRetry<unknown>('/catalog/projects').then((p) => pickArray<PayHubProject>(p, 'projects'));
  listContractors = () => this.getWithRetry<unknown>('/catalog/contractors').then((p) => pickArray<PayHubContractor>(p, 'contractors'));
  listLetterStatuses = () => this.getWithRetry<unknown>('/catalog/letter-statuses').then((p) => pickArray<PayHubLetterStatus>(p, 'statuses', 'letter_statuses'));

  // ---- Письма ----
  async createLetter(input: CreateLetterInput): Promise<PayHubLetterCreated> {
    const payload = await this.call<Record<string, unknown>>('POST', '/letters', { body: input });
    return { letter: unwrapLetter(payload), share: payload.share as PayHubShare | undefined };
  }

  async getLetter(id: string): Promise<PayHubLetter> {
    return unwrapLetter(await this.getWithRetry<unknown>(`/letters/${encodeURIComponent(id)}`));
  }

  /** Поиск письма по external_ref (идемпотентность). null — не найдено. */
  async lookupByRef(externalRef: string): Promise<PayHubLetterCreated | null> {
    try {
      const payload = await this.call<Record<string, unknown>>('GET', '/letters/lookup', {
        query: { external_ref: externalRef },
      });
      return { letter: unwrapLetter(payload), share: payload.share as PayHubShare | undefined };
    } catch (e) {
      if (e instanceof PayHubApiError && (e.httpStatus === 404 || e.httpStatus === 400)) return null;
      throw e;
    }
  }

  async shareLetter(id: string): Promise<PayHubShare> {
    const payload = await this.call<Record<string, unknown>>('POST', `/letters/${encodeURIComponent(id)}/share`);
    return (payload.share ?? payload) as PayHubShare;
  }

  /** Правка текста письма (тема/содержание/ответственный/дата). reg_number/участники не меняются. */
  async updateLetter(id: string, patch: UpdateLetterInput): Promise<void> {
    await this.call<void>('PATCH', `/letters/${encodeURIComponent(id)}`, { body: patch });
  }

  async deleteLetter(id: string): Promise<void> {
    await this.call<void>('DELETE', `/letters/${encodeURIComponent(id)}`);
  }

  // ---- Вложения (presign → PUT в S3 → register) ----
  async listAttachments(letterId: string): Promise<{ id: string; original_name?: string; size_bytes?: number; description?: string }[]> {
    const payload = await this.getWithRetry<unknown>(`/letters/${encodeURIComponent(letterId)}/attachments`);
    return pickArray(payload, 'attachments', 'items');
  }

  async uploadAttachment(letterId: string, file: UploadFileInput): Promise<{ id: string }> {
    const sizeBytes = file.bytes.byteLength;
    if (sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new PayHubApiError(`PayHub: файл превышает лимит 300 МБ (${sizeBytes} байт)`, 0, 'too_large', false);
    }
    const presign = await this.call<{ url: string; headers?: Record<string, string>; storage_path: string }>(
      'POST',
      `/letters/${encodeURIComponent(letterId)}/attachments/presign-upload`,
      { body: { file_name: file.name, content_type: file.mime_type, size_bytes: sizeBytes } },
    );
    const putRes = await fetch(presign.url, {
      method: 'PUT',
      redirect: 'error',
      headers: { ...(presign.headers ?? {}), ...(file.mime_type ? { 'Content-Type': file.mime_type } : {}) },
      body: file.bytes,
      signal: AbortSignal.timeout(PUT_BINARY_TIMEOUT_MS),
    }).catch((e) => {
      throw new PayHubApiError(`Загрузка вложения в PayHub S3 не удалась: ${(e as Error).message}`, 0, 'network', true);
    });
    if (!putRes.ok) {
      const retryable = putRes.status === 429 || putRes.status >= 500;
      throw new PayHubApiError(`S3 PayHub ответил ${putRes.status}`, putRes.status, 's3_error', retryable);
    }
    return this.call<{ id: string }>('POST', `/letters/${encodeURIComponent(letterId)}/attachments`, {
      body: {
        original_name: file.name,
        storage_path: presign.storage_path,
        size_bytes: sizeBytes,
        mime_type: file.mime_type ?? null,
        description: file.description ?? null,
      },
    });
  }

  // ---- Служебное ----
  async ping(): Promise<{ ok: true; latencyMs: number }> {
    const started = process.hrtime.bigint();
    await this.call<unknown>('GET', '/catalog/letter-statuses', { timeoutMs: PING_TIMEOUT_MS });
    return { ok: true, latencyMs: Number(process.hrtime.bigint() - started) / 1e6 };
  }
}

/** Фабрика из config. null — интеграция не настроена (валидное состояние). */
export function getPayHubClient(): PayHubClient | null {
  if (!config.payhub.configured) return null;
  return new PayHubClient({
    baseUrl: config.payhub.baseUrl,
    token: config.payhub.apiToken,
    timeoutMs: config.payhub.timeoutMs,
  });
}
