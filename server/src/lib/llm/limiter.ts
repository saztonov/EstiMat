/**
 * Ограничители обращений к моделям: одновременность и темп.
 *
 * Ограничителей одновременности два, и они про разное:
 *  - LM Studio: у Qwen параллелизм = 1, иначе два чата/задания РД дадут очередь и таймауты на
 *    самом сервере. Слот держится на всю единицу работы (ход агента, набор группировки).
 *  - ИИ-шлюз (OpenRouter/прокси): потолок на весь процесс. Внутри одного задания группировка и так
 *    шлёт по несколько наборов, но заданий бывает несколько сразу, плюс ИИ-чат и извлечение РД —
 *    общий поток упирался в лимиты шлюза и возвращался отказами 5xx. Слот берётся на одну
 *    HTTP-попытку, а не на весь вызов с ретраями: во время паузы между попытками держать его незачем.
 *
 * Темпа не хватало отдельно. Семафор ограничивает, сколько запросов идёт ОДНОВРЕМЕННО, но не
 * ограничивает, сколько их уходит в минуту: когда шлюз отвечает отказом за доли секунды, слот
 * освобождается сразу, и четыре слота с паузой 1.5 с давали больше сотни запросов в минуту. Именно
 * так и выглядел инцидент 17.07 — 58 запросов за 12 секунд. Поэтому рядом с семафором стоит
 * RateGate: он разносит сами отправки.
 */
import { config } from '../../config.js';

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  load(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
  }
}

/** Состояние очереди отправок: момент, раньше которого следующая отправка уйти не может. */
export interface RateState {
  nextAt: number;
}

/**
 * Занять ближайшую свободную щель и вернуть, сколько до неё ждать.
 *
 * Синхронная и без времени внутри — в этом весь смысл. Синхронная: щель достаётся тому, кто пришёл
 * первым, и два одновременных вызывающих не могут получить одну и ту же. Без времени: вся
 * арифметика темпа проверяется тестом, а не таймерами.
 *
 * Кредит за простой не копится: если ждать никого не пришлось, отправка уходит сразу, но права
 * «выпустить пачку за спокойный час» не появляется. Этим и отличается от token-bucket с запасом —
 * запас и есть разрешение на всплеск, а всплеск был инцидентом.
 */
export function reserveSlot(state: RateState, now: number, minIntervalMs: number): number {
  const at = Math.max(now, state.nextAt);
  state.nextAt = at + minIntervalMs;
  return at - now;
}

/** Минимальный интервал между отправками — token-bucket ёмкостью ровно в один токен. */
class RateGate {
  private readonly state: RateState = { nextAt: 0 };
  private waiting = 0;
  constructor(private readonly minIntervalMs: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    const waitMs = reserveSlot(this.state, Date.now(), this.minIntervalMs);
    if (waitMs <= 0) return;
    this.waiting++;
    try {
      await sleep(waitMs, signal);
    } finally {
      this.waiting--;
    }
  }

  load(): { rateWaiting: number } {
    return { rateWaiting: this.waiting };
  }
}

/** Прерываемый сон: без сигнала отмена задания ждала бы всю паузу темпа. */
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

const lmStudioSemaphore = new Semaphore(Math.max(1, config.lmstudio.maxConcurrency));
const gatewaySemaphore = new Semaphore(Math.max(1, config.ai.maxConcurrency));
const gatewayRate = new RateGate(Math.max(0, config.ai.minIntervalMs));

/** Выполнить fn в слоте LM Studio (сериализация под worker=1). */
export function withLmStudioSlot<T>(fn: () => Promise<T>): Promise<T> {
  return lmStudioSemaphore.run(fn);
}

/**
 * Выполнить fn в слоте ИИ-шлюза: потолок одновременных запросов на процесс плюс интервал между
 * отправками.
 *
 * Берётся внутри слота LM Studio, а не наоборот: порядок захвата всегда один, поэтому взаимной
 * блокировки не возникает.
 */
export function withLlmGatewaySlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return gatewaySemaphore.run(async () => {
    // Щель берём УЖЕ В СЛОТЕ, вплотную к отправке: тогда интервал считается от фактических
    // отправок. В обратном порядке он не значит ничего — пока запрос ждёт слот, его щель протухает,
    // и при освобождении двух слотов оба уйдут одновременно.
    await gatewayRate.acquire(signal);
    return fn();
  });
}

/** Сколько запросов к шлюзу идёт, сколько ждёт слота и сколько — своей щели. Для диагностики. */
export function gatewayLoad(): { active: number; queued: number; max: number; rateWaiting: number } {
  return {
    ...gatewaySemaphore.load(),
    max: Math.max(1, config.ai.maxConcurrency),
    ...gatewayRate.load(),
  };
}
