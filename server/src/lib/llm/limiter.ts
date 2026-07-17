/**
 * Ограничители одновременных обращений к моделям.
 *
 * Их два, и они про разное:
 *  - LM Studio: у Qwen параллелизм = 1, иначе два чата/задания РД дадут очередь и таймауты на
 *    самом сервере. Слот держится на всю единицу работы (ход агента, набор группировки).
 *  - ИИ-шлюз (OpenRouter/прокси): потолок на весь процесс. Внутри одного задания группировка и так
 *    шлёт по 4 набора, но заданий бывает несколько сразу, плюс ИИ-чат и извлечение РД — общий
 *    поток упирался в лимиты шлюза и возвращался отказами 5xx. Слот берётся на одну HTTP-попытку,
 *    а не на весь вызов с ретраями: во время паузы между попытками держать его незачем.
 */
import { config } from '../../config.js';

class Semaphore {
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

const lmStudioSemaphore = new Semaphore(Math.max(1, config.lmstudio.maxConcurrency));
const gatewaySemaphore = new Semaphore(Math.max(1, config.ai.maxConcurrency));

/** Выполнить fn в слоте LM Studio (сериализация под worker=1). */
export function withLmStudioSlot<T>(fn: () => Promise<T>): Promise<T> {
  return lmStudioSemaphore.run(fn);
}

/**
 * Выполнить fn в слоте ИИ-шлюза — общий потолок одновременных запросов на процесс.
 *
 * Берётся внутри слота LM Studio, а не наоборот: порядок захвата всегда один, поэтому взаимной
 * блокировки не возникает.
 */
export function withLlmGatewaySlot<T>(fn: () => Promise<T>): Promise<T> {
  return gatewaySemaphore.run(fn);
}

/** Сколько запросов к шлюзу идёт и сколько ждёт очереди — для журнала и диагностики. */
export function gatewayLoad(): { active: number; queued: number; max: number } {
  return { ...gatewaySemaphore.load(), max: Math.max(1, config.ai.maxConcurrency) };
}
