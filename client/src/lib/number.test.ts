import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRu, parseRu, formatMoney } from './number';

const NBSP = String.fromCharCode(0x00a0);
const NNBSP = String.fromCharCode(0x202f);

test('formatRu: разделитель тысяч и десятичная запятая', () => {
  assert.equal(formatRu(1234567.89), `1${NBSP}234${NBSP}567,89`);
  assert.equal(formatRu(0), '0');
  assert.equal(formatRu(999), '999');
  assert.equal(formatRu(-1234.5), `-1${NBSP}234,5`);
  assert.equal(formatRu(null), '');
  assert.equal(formatRu(''), '');
});

test('parseRu: снимает пробелы (обычный/NBSP/узкий) и приводит запятую к точке', () => {
  assert.equal(parseRu(`1${NBSP}234,5`), '1234.5');
  assert.equal(parseRu(`1${NNBSP}234 567,89`), '1234567.89');
  assert.equal(parseRu('1234.5'), '1234.5');
  assert.equal(parseRu(''), '');
});

test('formatMoney: всегда 2 знака', () => {
  assert.equal(formatMoney(1234.5), `1${NBSP}234,50`);
  assert.equal(formatMoney(1000000000), `1${NBSP}000${NBSP}000${NBSP}000,00`);
  assert.equal(formatMoney(null), '');
  assert.equal(formatMoney('abc'), '');
});

test('round-trip: parse(format(x)) === x', () => {
  for (const x of [0, 1, 12.34, 1234567.89, 999999999.99]) {
    assert.equal(Number(parseRu(formatRu(x))), x);
  }
});
