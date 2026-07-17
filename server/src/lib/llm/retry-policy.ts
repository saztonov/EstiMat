/**
 * Политика повторов при обращении к ИИ-шлюзу — чистыми функциями, без HTTP.
 *
 * Здесь, а не в клиенте, по двум причинам. Первая: клиентов к шлюзу два (lib/llm/openrouter и
 * lib/extract/llm/openrouter), и разъехавшаяся политика — это разъехавшиеся лимиты, то есть отказы
 * прокси. Вторая: решения дорогие по последствиям (шторм на шлюзе, платные повторы), а проверить их
 * на живом шлюзе негде — чистая функция проверяется тестом.
 *
 * Профиль, который прокси гарантированно принимает: не больше 2 запросов одновременно, не чаще
 * ~50 в минуту, повтор с уважением Retry-After. Одновременность держит семафор (lib/llm/limiter),
 * темп — RateGate там же, а что и когда повторять — этот модуль.
 */

/** Повторов после первой попытки. Всего попыток — на одну больше. */
export const MAX_RETRIES = 4;
export const BASE_BACKOFF_MS = 1500;
/**
 * Потолок для Retry-After. Прокси просит 10 секунд, но заголовок приходит извне: без потолка
 * `Retry-After: 3600` усыпил бы задание на час, и оно упёрлось бы в дедлайн, ничего не посчитав.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

/** Коды отказов прокси, при которых повтор бессмыслен: ответ не изменится. */
const FATAL_CODES = new Set(['model_not_allowed', 'invalid_request', 'unauthorized', 'payload_too_large']);

/**
 * Ретраебельные статусы.
 *
 * 429/503 — лимиты прокси (очередь, темп, соединения), 504 — его дедлайн в 190 с, 500/502 —
 * сбой выше по течению, 408 — таймаут запроса. Всё это лечится повтором.
 *
 * 502 повторяем осознанно: им же обозначен «ответ модели больше 2 МБ», где повтор бесполезен, но
 * отличить его от сброса соединения по статусу нельзя (см. code ниже). Лишний платный вызов в
 * редком случае дешевле, чем задание, упавшее на транзиентном сбое.
 *
 * Всё остальное — фатально: 400/401/403/404/413/422 это конфигурация или данные, и повтор даст
 * ровно тот же ответ, только за деньги.
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface GatewayFailure {
  retry: boolean;
  /** Код из тела ответа прокси (queue_full, dedup_full, …), если он там был. */
  code: string | null;
}

/** Достать error.code из тела прокси. Тело может быть чем угодно — HTML nginx, пустотой, мусором. */
function errorCodeOf(body: string): string | null {
  if (!body.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } };
    const code = parsed.error?.code;
    return typeof code === 'string' && code ? code : null;
  } catch {
    return null;
  }
}

/**
 * Повторять ли отказ шлюза. Код из тела точнее статуса: под 503 у прокси и «очередь занята»
 * (пройдёт), и переполнение таблицы дедупликации (тоже пройдёт), а под 400 — «модель запрещена»
 * (не пройдёт никогда).
 */
export function classifyGatewayFailure(status: number, body: string): GatewayFailure {
  const code = errorCodeOf(body);
  if (code && FATAL_CODES.has(code)) return { retry: false, code };
  return { retry: RETRYABLE_STATUSES.has(status), code };
}

/**
 * Retry-After в миллисекундах. По RFC 9110 это либо целое число секунд, либо HTTP-дата.
 * null — заголовка нет или он неразборчив (тогда берётся обычный backoff).
 */
export function parseRetryAfterMs(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header) return null;
  const raw = header.trim();
  if (!raw) return null;

  // Целое число секунд. Дробное значение спецификация не допускает — не выдумываем за отправителя.
  if (/^\d+$/.test(raw)) return Math.min(MAX_RETRY_AFTER_MS, Number(raw) * 1000);

  // Дата обязана содержать год, иначе Date.parse принимает за дату слишком многое: '1.5' он читает
  // как первое мая, и дробные секунды превратились бы в «ждать не надо» вместо «не понял заголовок».
  if (!/\d{4}/.test(raw)) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  // Дата в прошлом — ждать нечего, но это и не повод считать заголовок мусором.
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - nowMs));
}

/**
 * Пауза перед повтором.
 *
 * Разброс обязателен в обоих случаях: два воркера, получившие отказ одновременно, без него
 * повторят синхронно и снова упрутся в тот же лимит. Поверх Retry-After разброс только ВВЕРХ —
 * прийти раньше, чем просили, значит гарантированно получить второй отказ.
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | null, random = Math.random): number {
  if (retryAfterMs != null) return Math.round(retryAfterMs * (1 + random() * 0.2));
  const full = BASE_BACKOFF_MS * 2 ** attempt;
  return Math.round(full * (0.5 + random() * 0.5));
}

/**
 * Хватит ли бюджета вызова на ещё одну ПОЛНУЮ попытку.
 *
 * Иначе мы отправим прокси запрос, заведомо зная, что оборвём его раньше, чем истечёт его
 * собственный дедлайн: в его журнале это 499, а для нас — оплаченный ответ, который никто не
 * прочитает. Лучше признать неудачу сразу.
 */
export function canStartAttempt(nowMs: number, deadlineMs: number, attemptTimeoutMs: number): boolean {
  return deadlineMs - nowMs >= attemptTimeoutMs;
}
