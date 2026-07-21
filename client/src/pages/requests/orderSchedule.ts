/**
 * Контракт графика поставок: типы и проверка перед отправкой — без UI.
 *
 * Отделено от OrderScheduleEditor.tsx, потому что редактор тянет antd и React, а правило «сумма
 * сходится» проверяется тестами. Редактор реэкспортирует всё отсюда, поэтому импорты вызывающего
 * кода не меняются.
 */

const EPS = 1e-6;
const num = (v: number) => Math.round(v * 1e4) / 1e4;

/** Материал заказа с общим количеством (вход редактора). */
export interface OrderScheduleLine {
  aggKey: string;
  name: string;
  unit: string;
  quantity: number;
}

/** График по материалу (выход редактора → тело запроса заказа/тендера). */
export interface OrderScheduleValue {
  aggKey: string;
  entries: { deliveryDate: string; quantity: number }[];
}

/**
 * Что редактор знает, а value передать не может: value содержит только заполненные строки.
 * Без этого недозаполненный материал в режиме atMost выглядел бы как «заказано меньше».
 */
export interface ScheduleMeta {
  /** Материалы, где есть строка с количеством, но без даты (или дата без количества). */
  incomplete: string[];
  /** Материалы, явно исключённые пользователем из заказа. */
  excluded: string[];
}

/**
 * 'exact'  — сумма по датам равна количеству материала: заказ уже сформирован (правка графика,
 *            тендер), количество задано составом и графиком его менять нельзя.
 * 'atMost' — сумма по датам не больше ёмкости: создание заказа, где количество ЗАДАЁТСЯ графиком
 *            и заказать меньше остатка — штатный сценарий.
 */
export type ScheduleSumMode = 'exact' | 'atMost';

/**
 * Проверка графика перед отправкой: у каждого материала непустой график, даты не повторяются,
 * сумма сходится по правилу mode. Возвращает текст ошибки или null.
 */
export function validateOrderSchedule(
  lines: OrderScheduleLine[],
  value: OrderScheduleValue[],
  mode: ScheduleSumMode = 'exact',
): string | null {
  const byKey = new Map(value.map((v) => [v.aggKey, v.entries]));
  for (const l of lines) {
    const entries = byKey.get(l.aggKey) ?? [];
    if (!entries.length) return `Заполните график поставки: ${l.name}`;
    const dates = entries.map((e) => e.deliveryDate);
    if (new Set(dates).size !== dates.length) return `Даты поставки не должны повторяться: ${l.name}`;
    const sum = entries.reduce((s, e) => s + e.quantity, 0);
    if (mode === 'exact') {
      if (Math.abs(sum - l.quantity) > EPS) {
        return `Сумма по датам (${num(sum)}) ≠ количеству (${num(l.quantity)}): ${l.name}`;
      }
    } else {
      if (sum <= EPS) return `Укажите количество к поставке: ${l.name}`;
      if (sum - l.quantity > EPS) {
        return `Сумма по датам (${num(sum)}) больше остатка (${num(l.quantity)}): ${l.name}`;
      }
    }
  }
  return null;
}
