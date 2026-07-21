/**
 * Ключ области ответственного. Функция крошечная, но именно по этому ключу сопоставляются
 * результаты резолвера со строками свода: коллизия ключа — это чужой ответственный в чужой
 * строке, причём молча.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeKey } from './responsibles.js';
import { aggKey } from '@estimat/shared';

const P = '11111111-1111-1111-1111-111111111111';
const C = '22222222-2222-2222-2222-222222222222';
const T = '33333333-3333-3333-3333-333333333333';

test('одинаковые области дают одинаковый ключ', () => {
  const a = { projectId: P, contractorId: C, costTypeId: T, aggKey: 'txt:кирпич|шт' };
  assert.equal(scopeKey(a), scopeKey({ ...a }));
});

test('различие в любом поле меняет ключ', () => {
  const base = { projectId: P, contractorId: C, costTypeId: T, aggKey: 'txt:кирпич|шт' };
  const variants = [
    { ...base, projectId: C },
    { ...base, contractorId: P },
    { ...base, costTypeId: P },
    { ...base, aggKey: 'txt:кирпич|м3' },
  ];
  const keys = new Set(variants.map(scopeKey));
  assert.equal(keys.size, variants.length, 'варианты не должны схлопываться в один ключ');
  assert.ok(!keys.has(scopeKey(base)));
});

test('null-поле не равно заполненному', () => {
  const withNulls = { projectId: null, contractorId: null, costTypeId: null, aggKey: 'txt:кирпич|шт' };
  assert.notEqual(scopeKey(withNulls), scopeKey({ ...withNulls, projectId: P }));
});

test('разделитель внутри agg_key не создаёт коллизий', () => {
  // aggKey сам содержит '|' («txt:имя|единица»), и scopeKey клеит поля тем же символом. Коллизии
  // нет только потому, что agg_key стоит ПОСЛЕДНИМ, а предыдущие поля — UUID без '|'. Тест
  // фиксирует это свойство: если поля переставят местами, он упадёт.
  const a = { projectId: null, contractorId: null, costTypeId: T, aggKey: aggKey(null, 'кирпич', 'шт') };
  const b = { projectId: null, contractorId: null, costTypeId: null, aggKey: `${T}|txt:кирпич|шт` };
  assert.notEqual(scopeKey(a), scopeKey(b));
});
