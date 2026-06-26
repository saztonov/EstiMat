/**
 * Ограничитель одновременных запросов к серверу LM Studio. У Qwen параллелизм = 1,
 * поэтому без лимитера два чата/задания РД создадут очередь и таймауты на сервере.
 * Чат держит слот на весь ход агента, РД — на весь прогон извлечения.
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
}

const lmStudioSemaphore = new Semaphore(Math.max(1, config.lmstudio.maxConcurrency));

/** Выполнить fn в слоте LM Studio (сериализация под worker=1). */
export function withLmStudioSlot<T>(fn: () => Promise<T>): Promise<T> {
  return lmStudioSemaphore.run(fn);
}
