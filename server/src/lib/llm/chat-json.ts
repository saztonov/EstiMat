/**
 * Одиночный JSON-запрос к модели поверх chatWithTools (tools=[] → обычный chat completion).
 *
 * Добавляет то, чего нет в низкоуровневом клиенте:
 *  - проверку адреса LM Studio перед КАЖДЫМ вызовом (адрес правится админом и хранится в БД);
 *  - отказ на пустом ответе (Qwen умеет съесть весь бюджет в рассуждении и вернуть '').
 *
 * Таймаут и повторы живут в самом chatWithTools: они обязаны действовать во всех контурах, а не
 * только там, где вызывающий не забыл про обёртку.
 *
 * Возвращает не только текст: журналу группировки нужны фактически отправленные сообщения,
 * расход токенов и история HTTP-попыток. Собрать это позже нельзя — /no_think дописывается
 * здесь, а X-Request-Id свой у каждой попытки.
 */
import {
  chatWithTools, LlmTimeoutError,
  type ChatTurnMessage, type ChatContentPart, type HttpAttemptInfo,
} from './openrouter.js';
import type { ResolvedEndpoint } from './endpoint.js';
import { assertAllowedLmUrl } from './url-guard.js';

// Таймаут объявлен в openrouter (там он и срабатывает), но ловят его по этому имени — реэкспорт,
// чтобы у вызывающих не появлялся импорт из низкоуровневого клиента.
export { LlmTimeoutError };

export interface ChatJsonOptions {
  endpoint: ResolvedEndpoint;
  /** Отмена задания. Комбинируется с таймаутом попытки внутри клиента. */
  signal: AbortSignal;
  /** Таймаут одной попытки: отсчёт идёт после очереди к шлюзу. */
  attemptTimeoutMs: number;
  /** Бюджет всего вызова — попытки вместе с паузами между ними. */
  callBudgetMs: number;
  /** Ключ логического вызова для повторов (обычно id записи журнала). */
  idempotencyKey?: string;
  /** Режим Qwen без рассуждений: /no_think в system и user (чувствительно к позиции). */
  noThink?: boolean;
  /** Провайдер-специфичные поля тела (например выбор парсера PDF у OpenRouter). */
  extraBody?: Record<string, unknown>;
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

/** Размер data-URI в килобайтах — по длине base64, точность здесь не нужна. */
const dataUriKb = (uri: string) => Math.round((uri.length * 3) / 4 / 1024);

/**
 * Текстовая выжимка мультимодального сообщения для журнала: сами байты файла не пишем (см. вызов),
 * но должно быть видно, ЧТО именно ушло в модель.
 */
export function summarizeParts(parts: ChatContentPart[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'image_url') {
        const url = p.image_url.url;
        return url.startsWith('data:')
          ? `[изображение: ${url.slice(5, url.indexOf(';')) || 'image'}, ~${dataUriKb(url)} КБ]`
          : `[изображение: ${url}]`;
      }
      return `[файл: ${p.file.filename}, ~${dataUriKb(p.file.file_data)} КБ]`;
    })
    .join('\n');
}

/** Отправить system+user и вернуть ответ модели с метаданными. Разбор JSON — на стороне вызывающего. */
export async function chatJsonOnce(
  opts: ChatJsonOptions,
  system: string,
  user: string | ChatContentPart[],
): Promise<ChatJsonResult> {
  const { endpoint: ep } = opts;
  // Адрес LM Studio приходит из БД, а мы отправляем на него env-токен: проверяем перед вызовом,
  // а не только при сохранении настройки.
  if (ep.isLmStudio) assertAllowedLmUrl(ep.baseUrl);

  const sentSystem = opts.noThink ? `${system}\n\n/no_think` : system;
  // Мультимодальное сообщение: /no_think дописываем отдельной текстовой частью, а в журнал кладём
  // ВЫЖИМКУ. Base64 файла в журнале бесполезен для разбора и мгновенно упирается в лимит текста
  // (1 МиБ), вытесняя сам промпт — то есть ровно то, ради чего журнал и заведён.
  const userParts = typeof user === 'string' ? null : user;
  const userContent: string | ChatContentPart[] = userParts
    ? (opts.noThink ? [...userParts, { type: 'text' as const, text: '/no_think' }] : userParts)
    : (opts.noThink ? `${user as string}\n\n/no_think` : (user as string));
  const sentUser = userParts ? summarizeParts(userContent as ChatContentPart[]) : (userContent as string);

  const messages: ChatTurnMessage[] = [
    { role: 'system', content: sentSystem },
    { role: 'user', content: userContent },
  ];

  const attempts: HttpAttemptInfo[] = [];
  const startedAt = Date.now();

  let res;
  try {
    res = await chatWithTools(
      {
        apiKey: ep.apiKey,
        model: ep.model,
        baseUrl: ep.baseUrl,
        signal: opts.signal,
        maxTokens: ep.isLmStudio ? ep.maxTokens : undefined,
        isLmStudio: ep.isLmStudio,
        idempotencyKey: opts.idempotencyKey,
        attemptTimeoutMs: opts.attemptTimeoutMs,
        callBudgetMs: opts.callBudgetMs,
        observer: (a) => attempts.push(a),
        extraBody: opts.extraBody,
      },
      messages,
      [],
    );
  } catch (e) {
    // Клиент уже различил таймаут и отмену (LlmTimeoutError) — здесь только сохраняем историю
    // попыток: по упавшему вызову журнал иначе остался бы пустым.
    throw new LlmCallError(e, attempts, sentSystem, sentUser, Date.now() - startedAt);
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
