/**
 * Ошибка API — в ОТДЕЛЬНОМ модуле, не в api.ts.
 *
 * api.ts вычисляет BASE_URL из import.meta.env прямо при загрузке модуля, поэтому под tsx
 * (node --test) он не импортируется вовсе — а значит, разбор ошибок было нечем тестировать.
 * Здесь модуль свободен от переменных сборки. api.ts класс реэкспортирует: два объявления
 * сломали бы instanceof, и ошибка, брошенная обёрткой, не опозналась бы вызывающим кодом.
 */

/**
 * data/code несут тело ответа: при 409 — код конфликта и полезная нагрузка (например, список
 * позиций в перезаказе), чтобы вызывающий код мог отреагировать, не теряя черновик пользователя.
 *
 * ВАЖНО: обёртка пробрасывает из тела ответа ТОЛЬКО `data` и `code`. Всё, что сервер кладёт в
 * корень тела рядом с `error`, до вызывающего кода не доходит.
 */
export class ApiError extends Error {
  status: number;
  data?: unknown;
  code?: string;
  constructor(status: number, message: string, opts?: { data?: unknown; code?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = opts?.data;
    this.code = opts?.code;
  }
}
