// Остаток по строке материала: база колонки «Остаток» и набора долей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingOf } from './remaining';

test('остаток = кол-во по смете минус уже заявленное', () => {
  assert.equal(remainingOf(134.244, 100), 34.244);
  assert.equal(remainingOf(10, 0), 10, 'ничего не заявлено — остаток равен смете');
});

test('заявлено всё — остаток ноль, а не хвост плавающей точки', () => {
  assert.equal(remainingOf(134.244, 134.244), 0);
  assert.equal(remainingOf(0.1 + 0.2, 0.3), 0, '0.30000000000000004 − 0.3 не должно дать остаток');
});

test('заявлено сверх сметы — остаток ноль, а не отрицательный', () => {
  assert.equal(remainingOf(10, 25), 0);
});
