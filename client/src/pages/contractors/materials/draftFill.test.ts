// Набор заявки: массовое заполнение доли остатка, ручные строки, сводка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineKey } from '@estimat/shared';
import {
  availableOf,
  buildDraftIndex,
  clearDraftFor,
  draftStats,
  emptyDraft,
  fillDraft,
  setDraftValue,
} from './draftFill';
import type { OrderMaterialRow } from './orderRow';
import type { MaterialTreeNode } from './materialTree';

const row = (name: string, quantity: number, price: number | null = null): OrderMaterialRow =>
  ({
    orderKey: lineKey('ct1', `txt:${name}|шт`),
    name,
    quantity,
    unit: 'шт',
    orderUnitPrice: price,
    materialCost: price == null ? null : price * quantity,
  }) as OrderMaterialRow;

const ordered = (pairs: [OrderMaterialRow, number][]) =>
  new Map(pairs.map(([r, v]) => [r.orderKey, v]));

test('100% берёт остаток целиком и без дрейфа в последнем знаке', () => {
  const a = row('Кабель', 134.244);
  const res = fillDraft(emptyDraft(), [a], new Map(), 100);
  assert.equal(res.next.values.get(a.orderKey), 134.244);
  assert.equal(res.added, 1);
});

test('база доли — остаток, а не полный объём по смете', () => {
  const a = row('Кабель', 100);
  const res = fillDraft(emptyDraft(), [a], ordered([[a, 40]]), 50);
  // 50% от остатка (100 − 40 = 60), а не от 100.
  assert.equal(res.next.values.get(a.orderKey), 30);
});

test('массовое действие присваивает, а не накапливает: повторный клик не удваивает заказ', () => {
  const a = row('Кабель', 100);
  const first = fillDraft(emptyDraft(), [a], new Map(), 100);
  const second = fillDraft(first.next, [a], new Map(), 50);
  assert.equal(second.next.values.get(a.orderKey), 50, '100% → 50% даёт 50, а не 150');
  assert.equal(second.updated, 1);
  assert.equal(second.added, 0);
});

test('повторный 100% по уже заявленной группе даёт 0 — строка выпадает из черновика', () => {
  const a = row('Кабель', 100);
  // Заявку отправили: весь объём уже заявлен, остатка нет.
  const res = fillDraft(emptyDraft(), [a], ordered([[a, 100]]), 100);
  assert.equal(res.next.values.has(a.orderKey), false);
  assert.equal(res.noRemainder, 1);
  assert.equal(res.added, 0);
});

test('ручные строки массовое действие не трогает, а «Заменить ручные» — заменяет', () => {
  const a = row('Кабель', 100);
  const b = row('Труба', 100);
  const manual = setDraftValue(emptyDraft(), a.orderKey, 7);

  const kept = fillDraft(manual, [a, b], new Map(), 100);
  assert.equal(kept.next.values.get(a.orderKey), 7, 'ручное значение сохранено');
  assert.equal(kept.next.values.get(b.orderKey), 100);
  assert.equal(kept.manualKept, 1);

  const replaced = fillDraft(manual, [a, b], new Map(), 100, true);
  assert.equal(replaced.next.values.get(a.orderKey), 100, 'явная замена перезаписывает');
  assert.equal(replaced.next.manual.has(a.orderKey), false, 'значение снова расчётное');
});

test('построчный ввод: ноль и пустое убирают строку из заявки', () => {
  const a = row('Кабель', 100);
  const filled = setDraftValue(emptyDraft(), a.orderKey, 5);
  assert.equal(setDraftValue(filled, a.orderKey, 0).values.has(a.orderKey), false);
  assert.equal(setDraftValue(filled, a.orderKey, null).values.has(a.orderKey), false);
});

test('остаток не отрицателен, даже если заявлено сверх сметы', () => {
  const a = row('Кабель', 10);
  assert.equal(availableOf(a, ordered([[a, 25]])), 0);
  const res = fillDraft(emptyDraft(), [a], ordered([[a, 25]]), 100);
  assert.equal(res.next.values.has(a.orderKey), false);
});

test('доля округляется до 4 знаков', () => {
  const a = row('Смесь', 10);
  const res = fillDraft(emptyDraft(), [a], new Map(), 33);
  assert.equal(res.next.values.get(a.orderKey), 3.3);
});

test('деньги черновика считаются от заявляемого количества, а не от сметного объёма', () => {
  const a = row('Кабель', 100, 10); // materialCost = 1000 за весь сметный объём
  const b = row('Труба', 50); // цены нет
  const draft = fillDraft(emptyDraft(), [a, b], new Map(), 50).next;
  const stats = draftStats([a, b], draft);
  assert.equal(stats.count, 2);
  assert.equal(stats.money, 500, '50 шт × 10 ₽, а не materialCost = 1000');
  assert.equal(stats.pricedCount, 1, 'строка без цены в оценку не входит');
});

test('убрать группу из заявки — снимает и значения, и ручные пометки', () => {
  const a = row('Кабель', 100);
  const b = row('Труба', 100);
  const draft = setDraftValue(fillDraft(emptyDraft(), [a, b], new Map(), 100).next, a.orderKey, 3);
  const cleared = clearDraftFor(draft, [a, b]);
  assert.equal(cleared.values.size, 0);
  assert.equal(cleared.manual.size, 0);
});

test('индекс выбранного считает строки по всему поддереву узла', () => {
  const a = row('Кабель', 10);
  const b = row('Труба', 10);
  const leaf: MaterialTreeNode = {
    key: 'cat:1/ct:1',
    level: 'costType',
    label: 'Вид работ',
    badges: null,
    total: 0,
    rowCount: 2,
    pricedRowCount: 0,
    children: [],
    materials: [a, b],
  };
  const root: MaterialTreeNode = { ...leaf, key: 'cat:1', level: 'category', children: [leaf], materials: [] };
  const draft = fillDraft(emptyDraft(), [a], new Map(), 100).next;
  const index = buildDraftIndex([root], draft);
  assert.equal(index.get('cat:1/ct:1'), 1);
  assert.equal(index.get('cat:1'), 1, 'родитель считает строки потомков');
});
