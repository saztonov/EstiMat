// Цены материалов из закупок: средневзвешенная цена и подстановка в строки свода.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineKey } from '@estimat/shared';
import { applyOrderPrices, buildOrderedMaps, weightedUnitPrice } from './prices';
import type { OrderMaterialRow } from './orderRow';

test('цена — средневзвешенная по закупленному количеству, а не среднее арифметическое', () => {
  // 1000 шт по 10 ₽ и 1 шт по 100 ₽: простое среднее дало бы 55 ₽.
  assert.equal(weightedUnitPrice(1000 * 10 + 1 * 100, 1001), 10100 / 1001);
});

test('без закупленного количества цены нет (а не 0 ₽)', () => {
  assert.equal(weightedUnitPrice(null, null), null);
  assert.equal(weightedUnitPrice(0, 0), null, 'деления на ноль быть не должно');
  assert.equal(weightedUnitPrice(100, undefined), null);
});

test('бесплатная строка — это цена 0, а не «цены нет»', () => {
  assert.equal(weightedUnitPrice(0, 5), 0);
});

test('карта заказанного и цен строится по ключу заказа', () => {
  const maps = buildOrderedMaps([
    { cost_type_id: 'ct1', agg_key: 'a', ordered_qty: '10', priced_qty: '10', priced_amount: '2000' },
    // Материал заказан, но ещё не закуплен — цены нет.
    { cost_type_id: 'ct1', agg_key: 'b', ordered_qty: '5' },
    // Вид работ может отсутствовать.
    { cost_type_id: null, agg_key: 'c', ordered_qty: '1', priced_qty: '2', priced_amount: '50' },
  ]);

  assert.equal(maps.ordered.get(lineKey('ct1', 'a')), 10);
  assert.equal(maps.price.get(lineKey('ct1', 'a')), 200);
  assert.equal(maps.ordered.get(lineKey('ct1', 'b')), 5);
  assert.equal(maps.price.has(lineKey('ct1', 'b')), false);
  assert.equal(maps.price.get(lineKey(null, 'c')), 25);
});

const row = (orderKey: string, quantity: number): OrderMaterialRow =>
  ({ orderKey, quantity, orderUnitPrice: null, materialCost: null }) as OrderMaterialRow;

test('сумма = кол-во по смете × цена закупки; без цены — null, а не 0', () => {
  const rows = [row('k1', 4), row('k2', 3)];
  const [withPrice, without] = applyOrderPrices(rows, new Map([['k1', 250]]));

  assert.equal(withPrice!.orderUnitPrice, 250);
  assert.equal(withPrice!.materialCost, 1000);
  assert.equal(without!.orderUnitPrice, null);
  assert.equal(without!.materialCost, null, 'прочерк, а не 0 ₽: цена неизвестна');
});

test('цены нет ни у кого — строки возвращаются как есть (лишних перерисовок нет)', () => {
  const rows = [row('k1', 4)];
  assert.equal(applyOrderPrices(rows, new Map())[0], rows[0], 'ссылка не меняется');
});
