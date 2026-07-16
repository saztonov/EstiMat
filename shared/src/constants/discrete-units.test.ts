// Неделимые единицы: дробное количество штучного материала.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDiscreteQuantity, isDiscreteUnit } from './discrete-units.js';

test('дробное количество в штуках — замечание с округлением вверх', () => {
  assert.deepEqual(checkDiscreteQuantity('шт', 0.5), { quantity: 0.5, suggested: 1 });
  assert.deepEqual(checkDiscreteQuantity('компл', 1.5), { quantity: 1.5, suggested: 2 });
  assert.deepEqual(checkDiscreteQuantity('1 точка', 2.5), { quantity: 2.5, suggested: 3 });
});

test('запись единицы не влияет: регистр, точки и пробелы нормализуются', () => {
  for (const unit of ['шт', 'шт.', 'ШТ', ' Шт ', 'штук', 'штуки']) {
    assert.ok(isDiscreteUnit(unit), `${unit} — штучная единица`);
    assert.ok(checkDiscreteQuantity(unit, 0.5), `${unit}: 0,5 — замечание`);
  }
  assert.ok(isDiscreteUnit('к-т'));
  assert.ok(isDiscreteUnit('этаж/лифт'), 'единица справочника называется целиком «этаж/лифт»');
});

test('целое количество замечания не даёт', () => {
  assert.equal(checkDiscreteQuantity('шт', 200), null);
  assert.equal(checkDiscreteQuantity('шт', 1), null);
});

test('хвост плавающей точки — не дробь', () => {
  assert.equal(checkDiscreteQuantity('шт', 200.00000001), null);
  assert.equal(checkDiscreteQuantity('шт', 199.99999999), null);
  assert.equal(checkDiscreteQuantity('шт', 0.1 + 0.2 + 0.7), null, '1.0000000000000002 — это 1 шт');
});

test('делимые единицы не проверяем: 134,244 м² — норма', () => {
  assert.equal(checkDiscreteQuantity('м2', 134.244), null);
  assert.equal(checkDiscreteQuantity('м3', 10.516), null);
  assert.equal(checkDiscreteQuantity('кг', 0.5), null);
  assert.equal(isDiscreteUnit('м'), false);
});

test('незнакомая единица — молчим, а не гадаем', () => {
  assert.equal(checkDiscreteQuantity('бухта', 0.5), null);
  assert.equal(checkDiscreteQuantity('', 0.5), null);
  assert.equal(checkDiscreteQuantity(null, 0.5), null);
  assert.equal(isDiscreteUnit(undefined), false);
});

test('нулевое и бессмысленное количество замечания не даёт', () => {
  assert.equal(checkDiscreteQuantity('шт', 0), null);
  assert.equal(checkDiscreteQuantity('шт', -1.5), null);
  assert.equal(checkDiscreteQuantity('шт', Number.NaN), null);
});
