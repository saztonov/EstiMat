/**
 * Нейтральный низкоуровневый клиент OpenRouter (OpenAI-совместимый Chat
 * Completions) с поддержкой function/tool calling. Не зависит от extract-ядра —
 * используется ИИ-чатом и может быть переиспользован другими сценариями.
 *
 * Экспоненциальный backoff на 429/5xx, прерывание через AbortSignal.
 *
 * Наблюдаемость: каждая HTTP-попытка сообщается через необязательный `observer` — у попытки свой
 * X-Request-Id, свой код и своя длительность, и одной сводной записи на вызов недостаточно, чтобы
 * потом свериться с журналом прокси. Потребитель (журнал группировки) подписывается по желанию;
 * ИИ-чат работает как раньше.
 */

import { randomUUID } from 'node:crypto';
import { withLlmGatewaySlot } from './limiter.js';

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;
/** Тело ошибки — для показа человеку, а не для разбора: длинный HTML прокси незачем хранить. */
const MAX_ERROR_BODY_CHARS = 2000;
/**
 * Сколько тела попадает в ТЕКСТ ошибки. Он уходит в last_error задания и оттуда прямо в плашку на
 * экране сметчика, поэтому целой HTML-страницы шлюза там быть не должно — полное тело лежит в
 * журнале вызовов (поле errorBody).
 */
const MAX_ERROR_MESSAGE_CHARS = 200;

/** Прерываемый сон: без этого отмена задания ждала бы весь backoff (до 24 с). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Управляющие символы (кроме таба и переводов строк) — экранированно, чтобы их не было в исходнике. */
const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]', 'g');

/**
 * Тело ответа об ошибке — в лог и на экран. Управляющие символы убираем (портят вывод), длину
 * режем, значения токенов маскируем: адрес шлюза настраивается админом, и ответ постороннего
 * сервиса может содержать эхо заголовка авторизации.
 */
export function sanitizeErrorBody(raw: string): string {
  const masked = raw
    .replace(/(Bearer\s+)[\w.\-~+/]+=*/gi, '$1***')
    .replace(/(sk-[\w-]{4})[\w-]+/gi, '$1***')
    .replace(CONTROL_CHARS, ' ')
    .trim();
  return masked.length > MAX_ERROR_BODY_CHARS ? `${masked.slice(0, MAX_ERROR_BODY_CHARS)}…` : masked;
}

/**
 * Отказ шлюза с сохранённым телом.
 *
 * Текст намеренно не называет провайдера: baseUrl может указывать на собственный прокси, и
 * «OpenRouter 503» в этом случае врёт — 503 мог отдать прокси, не доходя до OpenRouter.
 */
export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly requestId: string | null,
    readonly attempts: number,
  ) {
    super(LlmHttpError.describe(status, body));
    this.name = 'LlmHttpError';
  }

  /** Короткая причина в одну строку: этот текст читает сметчик, а не разработчик. */
  private static describe(status: number, body: string): string {
    const short = body.replace(/\s+/g, ' ').trim();
    if (!short) return `ИИ-шлюз вернул ${status}`;
    const cut = short.length > MAX_ERROR_MESSAGE_CHARS ? `${short.slice(0, MAX_ERROR_MESSAGE_CHARS)}…` : short;
    return `ИИ-шлюз вернул ${status}: ${cut}`;
  }
}

/** Одна фактическая HTTP-попытка — для журнала. */
export interface HttpAttemptInfo {
  /** Номер попытки, с 1. */
  no: number;
  /** X-Request-Id этой попытки: у прокси он в журнале. */
  requestId: string;
  status: number | null;
  /** Сколько ждали свободный слот шлюза. Отделено от времени запроса: это очередь, а не модель. */
  waitedMs: number;
  durationMs: number;
  /** Пауза перед следующей попыткой; null — повтора не будет. */
  retryDelayMs: number | null;
  /** Тело ответа при отказе (очищенное и усечённое). */
  errorBody: string | null;
  /** Сетевой сбой/отмена — ответа не было вовсе. */
  networkError: string | null;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  signal?: AbortSignal;
  /** Лимит токенов ответа (для LM Studio/Qwen — чтобы рассуждение не съедало ответ). */
  maxTokens?: number;
  /** Наблюдатель за попытками. Его исключения на вызов не влияют. */
  observer?: (attempt: HttpAttemptInfo) => void;
}

/** Описание инструмента (function calling), формат OpenAI/OpenRouter. */
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON Schema параметров. */
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Сообщение в диалоге (включая ответы инструментов). */
export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  /** Для role='tool': к какому вызову относится результат. */
  tool_call_id?: string;
  /** Для role='tool': имя инструмента (информативно). */
  name?: string;
}

export interface ChatWithToolsResult {
  message: ChatTurnMessage;
  /** 'stop' | 'tool_calls' | 'length' | ... */
  finishReason: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** Сколько HTTP-попыток понадобилось (1 — с первой). */
  attempts?: number;
  /** X-Request-Id удачной попытки. */
  requestId?: string;
}

interface ChatCompletionChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: ChatWithToolsResult['usage'];
}

/**
 * Один обмен с моделью. Если переданы `tools`, модель может вернуть `tool_calls`
 * (тогда finishReason='tool_calls'); если `tools` пуст — вынуждаем текстовый ответ.
 */
export async function chatWithTools(
  opts: OpenRouterClientOptions,
  messages: ChatTurnMessage[],
  tools: ToolDef[],
): Promise<ChatWithToolsResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: 0.1,
    messages,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const notify = (info: HttpAttemptInfo) => {
    try {
      opts.observer?.(info);
    } catch {
      // Журнал не должен ломать вызов модели.
    }
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Трейсинг в журнале proxy_llm (если baseUrl указывает на прокси). Свежий id
    // на каждую попытку — прокси сам сгенерирует его при отсутствии заголовка.
    const requestId = randomUUID();
    const queuedAt = Date.now();
    let waitedMs = 0;
    let startedAt = queuedAt;
    let res: Response;
    let data: ChatCompletionResponse | null = null;
    let errorBody: string | null = null;

    try {
      // Слот — на одну попытку, а не на весь вызов: во время паузы перед повтором держать его
      // незачем, иначе четыре ждущих запроса заняли бы весь потолок на десятки секунд.
      // Тело читаем здесь же: пока оно не прочитано, соединение со шлюзом ещё занято.
      ({ res, data, errorBody } = await withLlmGatewaySlot(async () => {
        waitedMs = Date.now() - queuedAt;
        startedAt = Date.now();
        const r = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: opts.signal,
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
          },
          body: JSON.stringify(body),
        });
        if (r.ok) return { res: r, data: (await r.json()) as ChatCompletionResponse, errorBody: null };
        // Без тела «503» не отличить от «503, потому что кончился баланс», а при работе через
        // прокси — прокси это или сам OpenRouter.
        return { res: r, data: null, errorBody: sanitizeErrorBody(await r.text().catch(() => '')) };
      }));
    } catch (err) {
      // Сеть отвалилась или вызов отменили: попытка тоже часть истории.
      notify({
        no: attempt + 1,
        requestId,
        status: null,
        waitedMs,
        durationMs: Date.now() - startedAt,
        retryDelayMs: null,
        errorBody: null,
        networkError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (res.ok && data) {
      notify({
        no: attempt + 1,
        requestId,
        status: res.status,
        waitedMs,
        durationMs: Date.now() - startedAt,
        retryDelayMs: null,
        errorBody: null,
        networkError: null,
      });
      const choice = data.choices?.[0];
      const msg = choice?.message;
      return {
        message: {
          role: 'assistant',
          content: msg?.content ?? null,
          tool_calls: msg?.tool_calls,
        },
        finishReason: choice?.finish_reason ?? 'stop',
        usage: data.usage,
        attempts: attempt + 1,
        requestId,
      };
    }

    const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
    const isLast = attempt === MAX_RETRIES;
    // Спать после последней попытки бессмысленно: следующей не будет, а вызов задерживается.
    const retryDelayMs = retryable && !isLast ? BASE_BACKOFF_MS * 2 ** attempt : null;

    notify({
      no: attempt + 1,
      requestId,
      status: res.status,
      waitedMs,
      durationMs: Date.now() - startedAt,
      retryDelayMs,
      errorBody,
      networkError: null,
    });

    const err = new LlmHttpError(res.status, errorBody ?? '', requestId, attempt + 1);
    // Ретраим только на 429 и 5xx.
    if (!retryable) throw err;
    lastErr = err;
    if (retryDelayMs === null) break;
    await sleep(retryDelayMs, opts.signal);
    if (opts.signal?.aborted) break;
  }
  throw lastErr ?? new Error('ИИ-шлюз: исчерпаны попытки');
}
