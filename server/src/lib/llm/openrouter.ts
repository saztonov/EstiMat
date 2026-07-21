/**
 * Нейтральный низкоуровневый клиент OpenRouter (OpenAI-совместимый Chat
 * Completions) с поддержкой function/tool calling. Не зависит от extract-ядра —
 * используется ИИ-чатом и может быть переиспользован другими сценариями.
 *
 * Единственное место, где живёт транспорт к шлюзу: слот и темп (lib/llm/limiter), таймаут попытки,
 * бюджет вызова, повторы по политике (lib/llm/retry-policy). Всё это здесь, а не у вызывающих,
 * потому что лимиты у прокси общие на процесс: контур, обошедший это место, ломает их для всех.
 *
 * Две величины времени, и путать их нельзя. Таймаут ПОПЫТКИ (attemptTimeoutMs) больше дедлайна
 * прокси: оборвать запрос раньше, чем он ответит, — это 499 в его журнале и оплаченный ответ,
 * который мы не прочитали. Бюджет ВЫЗОВА (callBudgetMs) ограничивает попытки вместе с паузами;
 * одного таймаута на весь вызов не хватало — при таймауте больше дедлайна прокси повтор в него
 * просто не помещался.
 *
 * Наблюдаемость: каждая HTTP-попытка сообщается через необязательный `observer` — у попытки свой
 * X-Request-Id, свой код и своя длительность, и одной сводной записи на вызов недостаточно, чтобы
 * потом свериться с журналом прокси. Потребитель (журнал группировки) подписывается по желанию;
 * ИИ-чат работает как раньше.
 */

import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { withLlmGatewaySlot } from './limiter.js';
import { MAX_RETRIES, canStartAttempt, classifyGatewayFailure, parseRetryAfterMs, retryDelayMs } from './retry-policy.js';

/**
 * Бюджет вызова по умолчанию. 420 с — это две полновесные попытки по 200 с плюс паузы: столько
 * нужно, чтобы пережить один таймаут прокси и всё же получить ответ. На быстрых отказах (503 за
 * доли секунды) бюджет почти не тратится, и доступны все попытки.
 */
const DEFAULT_CALL_BUDGET_MS = 420_000;
/**
 * У локального сервера дедлайна прокси нет, зато Qwen думает долго — на своей модели ждём дольше.
 * Умолчания нужны контурам, которые время не задают (ИИ-чат): до них у вызовов не было вообще
 * никакого предела, и зависший upstream держал бы слот вечно.
 */
const DEFAULT_LM_ATTEMPT_TIMEOUT_MS = 240_000;
const DEFAULT_LM_CALL_BUDGET_MS = 600_000;
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

/** Модель не ответила за отведённое попытке время. Отличать от отмены задания: причины разные. */
export class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`Модель не ответила за ${Math.round(ms / 1000)} с`);
    this.name = 'LlmTimeoutError';
  }
}

/** Одна фактическая HTTP-попытка — для журнала. */
export interface HttpAttemptInfo {
  /** Номер попытки, с 1. */
  no: number;
  /** X-Request-Id этой попытки: у прокси он в журнале. */
  requestId: string;
  status: number | null;
  /**
   * Сколько ждали очереди к шлюзу: свободный слот и свою щель в темпе отправок. Отделено от
   * времени запроса — это очередь, а не модель, и в таймаут попытки не входит.
   */
  waitedMs: number;
  durationMs: number;
  /** Пауза перед следующей попыткой; null — повтора не будет. */
  retryDelayMs: number | null;
  /** Сколько просил подождать сам шлюз (Retry-After). null — не просил. */
  retryAfterMs: number | null;
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
  /**
   * Локальный сервер моделей. До прокси такие вызовы не доходят, поэтому его слот и темп они не
   * занимают: иначе один локальный прогон на 4 минуты держал бы половину потолка шлюза впустую.
   * Свой слот (worker=1) держит вызывающий — на всю единицу работы, а не на попытку.
   */
  isLmStudio?: boolean;
  /**
   * Ключ логического вызова: один на все попытки. Прокси по нему отсекает повторную оплату при
   * ретрае. Без него берётся случайный — заголовок есть всегда.
   */
  idempotencyKey?: string;
  /** Таймаут одной попытки. Отсчёт начинается после очереди — ждать не значит работать. */
  attemptTimeoutMs?: number;
  /** Бюджет всего вызова: попытки вместе с паузами. */
  callBudgetMs?: number;
  /** Наблюдатель за попытками. Его исключения на вызов не влияют. */
  observer?: (attempt: HttpAttemptInfo) => void;
  /**
   * Дополнительные поля тела запроса, специфичные для провайдера (например `plugins` OpenRouter
   * для выбора парсера PDF). Мержатся в тело последними.
   */
  extraBody?: Record<string, unknown>;
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

/**
 * Часть мультимодального сообщения (OpenAI-совместимый формат).
 *
 * Нужна там, где модели отдают не только текст: счёт поставщика приходит картинкой или PDF.
 * Изображения — image_url с data-URI, документы — file-часть; какой парсер применить к PDF,
 * решает вызывающий через extraBody (низкоуровневый клиент про счета ничего не знает).
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'file'; file: { filename: string; file_data: string } };

/**
 * Сообщение, ОТПРАВЛЯЕМОЕ модели (включая ответы инструментов).
 * content — строка либо набор частей; строковая форма остаётся основной.
 */
export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_calls?: ToolCall[];
  /** Для role='tool': к какому вызову относится результат. */
  tool_call_id?: string;
  /** Для role='tool': имя инструмента (информативно). */
  name?: string;
}

/**
 * Сообщение, ПОЛУЧЕННОЕ от модели. Отдельный тип от ChatTurnMessage сознательно: ответ всегда
 * текстовый, и если бы результат наследовал расширенный content, каждый потребитель (чат,
 * извлечение, группировка) получил бы `string | ChatContentPart[]` и перестал компилироваться.
 */
export interface ChatAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ChatWithToolsResult {
  message: ChatAssistantMessage;
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
  // Провайдер-специфичные поля (например выбор парсера PDF) задаёт вызывающий: клиент остаётся
  // нейтральным транспортом и не должен знать ни про счета, ни про стоимость движков распознавания.
  if (opts.extraBody) Object.assign(body, opts.extraBody);

  const notify = (info: HttpAttemptInfo) => {
    try {
      opts.observer?.(info);
    } catch {
      // Журнал не должен ломать вызов модели.
    }
  };

  // Ключ логического вызова — ОДИН на все попытки: по нему прокси отличает повтор после отказа от
  // нового запроса и не оплачивает его дважды. Этим он и отличается от X-Request-Id ниже.
  const idempotencyKey = opts.idempotencyKey ?? randomUUID();
  const attemptTimeoutMs =
    opts.attemptTimeoutMs ?? (opts.isLmStudio ? DEFAULT_LM_ATTEMPT_TIMEOUT_MS : config.ai.attemptTimeoutMs);
  const callDeadline =
    Date.now() + (opts.callBudgetMs ?? (opts.isLmStudio ? DEFAULT_LM_CALL_BUDGET_MS : DEFAULT_CALL_BUDGET_MS));
  // Локальный сервер моделей мимо шлюза — его лимиты к нему не относятся. Слот LM Studio здесь не
  // берём: его держит вызывающий на всю единицу работы, а семафор не реентрантный.
  const withSlot = <T>(fn: () => Promise<T>): Promise<T> =>
    opts.isLmStudio ? fn() : withLlmGatewaySlot(fn, opts.signal);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Попытку начинаем, только если бюджета хватит на неё целиком: иначе мы отправим запрос,
    // заведомо зная, что оборвём его раньше ответа.
    if (attempt > 0 && !canStartAttempt(Date.now(), callDeadline, attemptTimeoutMs)) break;

    // Трейсинг в журнале proxy_llm (если baseUrl указывает на прокси). Свежий id
    // на каждую попытку — прокси сам сгенерирует его при отсутствии заголовка.
    const requestId = randomUUID();
    const queuedAt = Date.now();
    let waitedMs = 0;
    let startedAt = queuedAt;
    let res: Response;
    let data: ChatCompletionResponse | null = null;
    let errorBody: string | null = null;
    let retryAfterMs: number | null = null;
    // Свой таймаут от чужой отмены отличает только этот флаг: первый — повод повторить, вторая нет.
    let timedOut = false;

    try {
      // Слот — на одну попытку, а не на весь вызов: во время паузы перед повтором держать его
      // незачем, иначе ждущие запросы заняли бы весь потолок на десятки секунд.
      // Тело читаем здесь же: пока оно не прочитано, соединение со шлюзом ещё занято.
      ({ res, data, errorBody, retryAfterMs } = await withSlot(async () => {
        waitedMs = Date.now() - queuedAt;
        startedAt = Date.now();
        // Таймаут взводим ЗДЕСЬ, а не до очереди: ожидание слота и щели — не работа модели, и
        // съедать им время запроса нельзя. Раньше на этом набор отваливался, не отправив ни байта.
        // Живёт он ровно столько, сколько идёт запрос: иначе таймер на три минуты держал бы
        // event loop всё время паузы перед повтором.
        const attemptAbort = new AbortController();
        const timer = setTimeout(() => {
          timedOut = true;
          attemptAbort.abort();
        }, attemptTimeoutMs);
        const signal = opts.signal ? AbortSignal.any([opts.signal, attemptAbort.signal]) : attemptAbort.signal;
        try {
          const r = await fetch(`${opts.baseUrl}/chat/completions`, {
            method: 'POST',
            signal,
            headers: {
              Authorization: `Bearer ${opts.apiKey}`,
              'Content-Type': 'application/json',
              'X-Request-Id': requestId,
              'X-Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(body),
          });
          if (r.ok) {
            return { res: r, data: (await r.json()) as ChatCompletionResponse, errorBody: null, retryAfterMs: null };
          }
          // Без тела «503» не отличить от «503, потому что кончился баланс», а при работе через
          // прокси — прокси это или сам OpenRouter.
          return {
            res: r,
            data: null,
            errorBody: sanitizeErrorBody(await r.text().catch(() => '')),
            retryAfterMs: parseRetryAfterMs(r.headers.get('retry-after')),
          };
        } finally {
          clearTimeout(timer);
        }
      }));
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      // Сеть отвалилась, вышло время попытки или вызов отменили — ответа не было вовсе.
      // Отмену не повторяем ни при каких условиях: это воля человека, и она главнее нашего
      // таймаута, даже если они сработали разом. Сеть и таймаут повторяем — они транзиентные.
      const aborted = opts.signal?.aborted ?? false;
      const retryable = !aborted && !isLast;
      const cause = timedOut && !aborted ? new LlmTimeoutError(attemptTimeoutMs) : err;
      const delay =
        retryable && canStartAttempt(Date.now(), callDeadline, attemptTimeoutMs)
          ? retryDelayMs(attempt, null)
          : null;
      notify({
        no: attempt + 1,
        requestId,
        status: null,
        waitedMs,
        durationMs: Date.now() - startedAt,
        retryDelayMs: delay,
        retryAfterMs: null,
        errorBody: null,
        networkError: cause instanceof Error ? cause.message : String(cause),
      });
      if (delay === null) throw cause;
      lastErr = cause;
      await sleep(delay, opts.signal);
      if (opts.signal?.aborted) throw cause;
      continue;
    }

    if (res.ok && data) {
      notify({
        no: attempt + 1,
        requestId,
        status: res.status,
        waitedMs,
        durationMs: Date.now() - startedAt,
        retryDelayMs: null,
        retryAfterMs: null,
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

    const { retry } = classifyGatewayFailure(res.status, errorBody ?? '');
    const isLast = attempt === MAX_RETRIES;
    // Спать после последней попытки бессмысленно: следующей не будет, а вызов задерживается.
    // И спать незачем, если на саму попытку бюджета уже не хватит.
    const delay =
      retry && !isLast && canStartAttempt(Date.now() + (retryAfterMs ?? 0), callDeadline, attemptTimeoutMs)
        ? retryDelayMs(attempt, retryAfterMs)
        : null;

    notify({
      no: attempt + 1,
      requestId,
      status: res.status,
      waitedMs,
      durationMs: Date.now() - startedAt,
      retryDelayMs: delay,
      retryAfterMs,
      errorBody,
      networkError: null,
    });

    const err = new LlmHttpError(res.status, errorBody ?? '', requestId, attempt + 1);
    // Повторяем только то, что повтор способен вылечить (см. lib/llm/retry-policy).
    if (!retry) throw err;
    lastErr = err;
    if (delay === null) break;
    await sleep(delay, opts.signal);
    if (opts.signal?.aborted) break;
  }
  throw lastErr ?? new Error('ИИ-шлюз: исчерпаны попытки');
}
