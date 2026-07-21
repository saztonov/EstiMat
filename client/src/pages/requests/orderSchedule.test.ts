import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderSchedule, type OrderScheduleLine } from './orderSchedule.js';

const LINES: OrderScheduleLine[] = [{ aggKey: 'A', name: 'Геотекстиль', unit: 'м2', quantity: 100 }];
const value = (entries: [string, number][]) => [
  { aggKey: 'A', entries: entries.map(([deliveryDate, quantity]) => ({ deliveryDate, quantity })) },
];

test('график exact: сумма должна совпасть с количеством', () => {
  assert.equal(validateOrderSchedule(LINES, value([['2026-07-30', 100]])), null);
  assert.match(
    validateOrderSchedule(LINES, value([['2026-07-30', 60]])) ?? '',
    /Сумма по датам \(60\) ≠ количеству \(100\)/,
  );
  assert.match(
    validateOrderSchedule(LINES, value([['2026-07-30', 120]])) ?? '',
    /Сумма по датам \(120\) ≠ количеству \(100\)/,
  );
});

test('график exact: режим по умолчанию — прежнее поведение тендера и правки графика', () => {
  // Без третьего аргумента правило обязано остаться строгим: на нём держатся два других окна.
  assert.equal(
    validateOrderSchedule(LINES, value([['2026-07-30', 60]])),
    validateOrderSchedule(LINES, value([['2026-07-30', 60]]), 'exact'),
  );
});

test('график atMost: заказать меньше остатка можно', () => {
  assert.equal(validateOrderSchedule(LINES, value([['2026-07-30', 60]]), 'atMost'), null);
  assert.equal(validateOrderSchedule(LINES, value([['2026-07-30', 100]]), 'atMost'), null);
});

test('график atMost: больше остатка нельзя', () => {
  assert.match(
    validateOrderSchedule(LINES, value([['2026-07-30', 120]]), 'atMost') ?? '',
    /больше остатка \(100\)/,
  );
});

test('график atMost: полный ноль отклоняется отдельным сообщением', () => {
  assert.match(
    validateOrderSchedule(LINES, value([['2026-07-30', 0]]), 'atMost') ?? '',
    /Укажите количество к поставке/,
  );
});

test('график: пустой список дат отклоняется в обоих режимах', () => {
  for (const mode of ['exact', 'atMost'] as const) {
    assert.match(
      validateOrderSchedule(LINES, [{ aggKey: 'A', entries: [] }], mode) ?? '',
      /Заполните график поставки/,
    );
    // Материала нет в value вовсе — тот же случай.
    assert.match(validateOrderSchedule(LINES, [], mode) ?? '', /Заполните график поставки/);
  }
});

test('график: повтор дат отклоняется в обоих режимах', () => {
  const dup = value([['2026-07-30', 50], ['2026-07-30', 50]]);
  for (const mode of ['exact', 'atMost'] as const) {
    assert.match(validateOrderSchedule(LINES, dup, mode) ?? '', /Даты поставки не должны повторяться/);
  }
});

test('график: дробная сумма в пределах EPS считается совпавшей', () => {
  const lines: OrderScheduleLine[] = [{ aggKey: 'A', name: 'Гидроизоляция', unit: 'м2', quantity: 27.9792 }];
  assert.equal(validateOrderSchedule(lines, value([['2026-07-30', 13.9896], ['2026-08-15', 13.9896]])), null);
});
