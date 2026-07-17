/**
 * Одиночный JSON-запрос к модели поверх chatWithTools (tools=[] → обычный chat completion).
 *
 * Добавляет то, чего нет в низкоуровневом клиенте:
 *  - таймаут (у chatWithTools только внешний signal — зависший upstream висел бы вечно);
 *  - проверку адреса LM Studio перед КАЖДЫМ вызовом (адрес правится админом и хранится в БД);
 *  - отказ на пустом ответе (Qwen умеет съесть весь бюджет в рассуждении и вернуть '').
 *
 * Возвращает не только текст: журналу группировки нужны фактически отправленные сообщения,
 * расход токенов и история HTTP-попыток. Собрать это позже нельзя — /no_think дописывается
 * здесь, а X-Request-Id свой у каждой попытки.
 */
import { chatWithTools, type ChatTurnMessage, type HttpAttemptInfo } from './openrouter.js';
import type { ResolvedEndpoint } from './endpoint.js';
import { assertAllowedLmUrl } from './url-guard.js';

export interface ChatJsonOptions {
  endpoint: ResolvedEndpoint;
  /** Отмена задания. Комбинируется с таймаутом вызова. */
  signal: AbortSignal;
  timeoutMs: number;
  /** Режим Qwen без рассуждений: /no_think в system и user (чувствительно к позиции). */
  noThink?: boolean;
}

/** Что реально ушло в модель и что она ответила — для журнала. */
export interface ChatJsonResult {
  content: string;
  finishReason: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** Тексты ровно как отправлены (с /no_think, если он добавлялся). */
  sentSystem: string;
  sentUser: string;
  /** Все HTTP-попытки, включая неудачные. */
  attempts: HttpAttemptInfo[];
  durationMs: number;
}

export class LlmEmptyResponseError extends Error {
  constructor() {
    super('Модель вернула пустой ответ');
    this.name = 'LlmEmptyResponseError';
  }
}

export class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`Модель не ответила за ${Math.round(ms / 1000)} с`);
    this.name = 'LlmTimeoutError';
  }
}

/**
 * Ошибка вызова с уже собранной историей попыток: без неё журнал по упавшему вызову остался бы
 * пустым — а именно упавшие вызовы и требуется разбирать.
 */
export class LlmCallError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempts: HttpAttemptInfo[],
    readonly sentSystem: string,
    readonly sentUser: string,
    readonly durationMs: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'LlmCallError';
  }
}

/** Отправить system+user и вернуть ответ модели с метаданными. Разбор JSON — на стороне вызывающего. */
export async function chatJsonOnce(opts: ChatJsonOptions, system: string, user: string): Promise<ChatJsonResult> {
  const { endpoint: ep } = opts;
  // Адрес LM Studio приходит из БД, а мы отправляем на него env-токен: проверяем перед вызовом,
  // а не только при сохранении настройки.
  if (ep.isLmStudio) assertAllowedLmUrl(ep.baseUrl);

  const sentSystem = opts.noThink ? `${system}\n\n/no_think` : system;
  const sentUser = opts.noThink ? `${user}\n\n/no_think` : user;
  const messages: ChatTurnMessage[] = [
    { role: 'system', content: sentSystem },
    { role: 'user', content: sentUser },
  ];

  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = AbortSignal.any([opts.signal, timeout]);
  const attempts: HttpAttemptInfo[] = [];
  const startedAt = Date.now();

  let res;
  try {
    res = await chatWithTools(
      {
        apiKey: ep.apiKey,
        model: ep.model,
        baseUrl: ep.baseUrl,
        signal,
        maxTokens: ep.isLmStudio ? ep.maxTokens : undefined,
        observer: (a) => attempts.push(a),
      },
      messages,
      [],
    );
  } catch (e) {
    // Таймаут вызова и отмена задания различимы только по тому, какой сигнал сработал.
    const err = timeout.aborted && !opts.signal.aborted ? new LlmTimeoutError(opts.timeoutMs) : e;
    throw new LlmCallError(err, attempts, sentSystem, sentUser, Date.now() - startedAt);
  }

  const durationMs = Date.now() - startedAt;
  const content = res.message.content ?? '';
  if (!content.trim()) {
    throw new LlmCallError(new LlmEmptyResponseError(), attempts, sentSystem, sentUser, durationMs);
  }
  return {
    content,
    finishReason: res.finishReason,
    usage: res.usage,
    sentSystem,
    sentUser,
    attempts,
    durationMs,
  };
}
