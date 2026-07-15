/**
 * Одиночный JSON-запрос к модели поверх chatWithTools (tools=[] → обычный chat completion).
 *
 * Добавляет то, чего нет в низкоуровневом клиенте:
 *  - таймаут (у chatWithTools только внешний signal — зависший upstream висел бы вечно);
 *  - проверку адреса LM Studio перед КАЖДЫМ вызовом (адрес правится админом и хранится в БД);
 *  - отказ на пустом ответе (Qwen умеет съесть весь бюджет в рассуждении и вернуть '').
 */
import { chatWithTools, type ChatTurnMessage } from './openrouter.js';
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

/** Отправить system+user и вернуть сырой текст ответа. Разбор JSON — на стороне вызывающего. */
export async function chatJsonOnce(opts: ChatJsonOptions, system: string, user: string): Promise<string> {
  const { endpoint: ep } = opts;
  // Адрес LM Studio приходит из БД, а мы отправляем на него env-токен: проверяем перед вызовом,
  // а не только при сохранении настройки.
  if (ep.isLmStudio) assertAllowedLmUrl(ep.baseUrl);

  const messages: ChatTurnMessage[] = [
    { role: 'system', content: opts.noThink ? `${system}\n\n/no_think` : system },
    { role: 'user', content: opts.noThink ? `${user}\n\n/no_think` : user },
  ];

  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = AbortSignal.any([opts.signal, timeout]);

  let res;
  try {
    res = await chatWithTools(
      {
        apiKey: ep.apiKey,
        model: ep.model,
        baseUrl: ep.baseUrl,
        signal,
        maxTokens: ep.isLmStudio ? ep.maxTokens : undefined,
      },
      messages,
      [],
    );
  } catch (e) {
    // Таймаут вызова и отмена задания различимы только по тому, какой сигнал сработал.
    if (timeout.aborted && !opts.signal.aborted) throw new LlmTimeoutError(opts.timeoutMs);
    throw e;
  }

  const content = res.message.content ?? '';
  if (!content.trim()) throw new LlmEmptyResponseError();
  return content;
}
