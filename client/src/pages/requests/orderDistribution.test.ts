import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capacitiesOf, aggregateScheduleLines, prefillFromRows, normalizeSchedule, distributeToRequestItems,
} from './orderDistribution.js';
import type { Su10MaterialRow } from './types.js';

// Минимальная строка свода: распределению важны только ключ материала, дата и остаток.
function row(p: {
  id: string; aggKey?: string; date?: string | null; remaining: number; name?: string;
}): Su10MaterialRow {
  return {
    request_item_id: p.id,
    request_id: `req-${p.id}`,
    request_no: 1,
    request_type: 'su10',
    status: 'approved',
    project_id: 'prj',
    project_name: 'Объект',
    project_code: 'О1',
    cost_type_id: 'ct',
    cost_type_name: 'Вид',
    category_id: 'cat',
    category_name: 'Категория',
    category_sort: 1,
    cost_type_sort: 1,
    material_id: 'mat',
    material_name: p.name ?? 'Геотекстиль',
    unit: 'м2',
    agg_key: p.aggKey ?? 'A',
    delivery_date: p.date === undefined ? '2026-07-30' : p.date,
    requested: p.remaining,
    ordered: 0,
    remaining: p.remaining,
    contractor_id: 'c1',
    contractor_name: 'Подрядчик',
    assigned_responsibles: [],
  };
}

const sched = (aggKey: string, entries: [string, number][]) => ({
  aggKey, entries: entries.map(([deliveryDate, quantity]) => ({ deliveryDate, quantity })),
});
const byId = (r: { items: { requestItemId: string; quantity: number }[] }) =>
  Object.fromEntries(r.items.map((i) => [i.requestItemId, i.quantity]));

test('распределение: даты графика совпали с датами позиций — каждая берёт своё', () => {
  const rows = [
    row({ id: 'i1', date: '2026-07-30', remaining: 100 }),
    row({ id: 'i2', date: '2026-08-15', remaining: 200 }),
  ];
  const caps = capacitiesOf(rows);
  const res = distributeToRequestItems(caps, [sched('A', [['2026-07-30', 100], ['2026-08-15', 200]])]);
  assert.deepEqual(byId(res), { i1: 100, i2: 200 });
  assert.deepEqual(res.unassigned, []);
});

test('распределение: заказ меньше остатка раздаётся по возрастанию даты', () => {
  const rows = [
    row({ id: 'i1', date: '2026-07-30', remaining: 6 }),
    row({ id: 'i2', date: '2026-08-15', remaining: 6 }),
  ];
  // Одна дата на 10 — совпадает с первой позицией (берёт 6), остаток 4 уходит второй.
  const res = distributeToRequestItems(capacitiesOf(rows), [sched('A', [['2026-07-30', 10]])]);
  assert.deepEqual(byId(res), { i1: 6, i2: 4 });
});

test('распределение: ни одна дата не совпала — всё раскладывается вторым проходом', () => {
  const rows = [
    row({ id: 'i1', date: '2026-07-30', remaining: 50 }),
    row({ id: 'i2', date: '2026-08-15', remaining: 50 }),
  ];
  const res = distributeToRequestItems(capacitiesOf(rows), [sched('A', [['2026-12-01', 70]])]);
  assert.deepEqual(byId(res), { i1: 50, i2: 20 });
  assert.deepEqual(res.unassigned, []);
});

test('распределение: две позиции на одну дату делят её объём', () => {
  const rows = [
    row({ id: 'i1', date: '2026-07-30', remaining: 30 }),
    row({ id: 'i2', date: '2026-07-30', remaining: 30 }),
  ];
  const res = distributeToRequestItems(capacitiesOf(rows), [sched('A', [['2026-07-30', 45]])]);
  assert.deepEqual(byId(res), { i1: 30, i2: 15 });
});

test('распределение: позиция без даты достаётся последней', () => {
  const rows = [
    row({ id: 'i-no', date: null, remaining: 40 }),
    row({ id: 'i-dated', date: '2026-07-30', remaining: 40 }),
  ];
  const res = distributeToRequestItems(capacitiesOf(rows), [sched('A', [['2026-07-30', 60]])]);
  // Датированная берёт своё по совпадению, недатированная добирает хвост.
  assert.deepEqual(byId(res), { 'i-dated': 40, 'i-no': 20 });
});

test('распределение: carry переносится в итог, а не затирается', () => {
  // Позиция уже размещена в этом заказе на 30, остаток к добору — 20.
  const rows = [row({ id: 'i1', remaining: 20 })];
  const caps = capacitiesOf(rows, new Map([['i1', 30]]));
  const res = distributeToRequestItems(caps, [sched('A', [['2026-07-30', 50]])]);
  // UPSERT абсолютный: отправить надо полные 50, иначе ранее размещённые 30 пропали бы.
  assert.deepEqual(byId(res), { i1: 50 });
});

test('распределение: позиция с carry без нового объёма всё равно отправляется', () => {
  const rows = [row({ id: 'i1', remaining: 0 })];
  const caps = capacitiesOf(rows, new Map([['i1', 30]]));
  const res = distributeToRequestItems(caps, [sched('A', [['2026-07-30', 30]])]);
  assert.deepEqual(byId(res), { i1: 30 });
});

test('распределение: base уменьшает бюджет — чужие позиции заказа не перезаписываются', () => {
  const rows = [row({ id: 'i1', remaining: 40 })];
  // В заказе уже лежит 25 по позиции, которой нет в payload; график покрывает весь заказ (65).
  const res = distributeToRequestItems(
    capacitiesOf(rows), [sched('A', [['2026-07-30', 65]])], new Map([['A', 25]]),
  );
  assert.deepEqual(byId(res), { i1: 40 });
  assert.deepEqual(res.unassigned, []);
});

test('распределение: обнулённый материал не попадает в позиции', () => {
  const rows = [row({ id: 'i1', aggKey: 'A', remaining: 10 }), row({ id: 'i2', aggKey: 'B', remaining: 10 })];
  const res = distributeToRequestItems(capacitiesOf(rows), [sched('A', [['2026-07-30', 10]])]);
  assert.deepEqual(byId(res), { i1: 10 });
});

test('распределение: дробные величины не накапливают ошибку', () => {
  const rows = [
    row({ id: 'i1', date: '2026-07-30', remaining: 27.9792 }),
    row({ id: 'i2', date: '2026-08-15', remaining: 2.2176 }),
  ];
  const schedule = [sched('A', [['2026-07-30', 0.1], ['2026-08-15', 0.2], ['2026-09-01', 27.8968]])];
  const res = distributeToRequestItems(capacitiesOf(rows), schedule);
  const sumItems = res.items.reduce((s, i) => s + i.quantity, 0);
  const sumSched = schedule[0]!.entries.reduce((s, e) => s + e.quantity, 0);
  assert.ok(Math.abs(sumItems - sumSched) < 1e-9, `${sumItems} vs ${sumSched}`);
  assert.deepEqual(res.unassigned, []);
});

test('распределение: перебор над ёмкостью виден в unassigned', () => {
  const rows = [row({ id: 'i1', remaining: 10 })];
  const res = distributeToRequestItems(capacitiesOf(rows), [sched('A', [['2026-07-30', 15]])]);
  assert.deepEqual(byId(res), { i1: 10 });
  assert.deepEqual(res.unassigned, [{ aggKey: 'A', quantity: 5 }]);
});

test('материалы графика: ёмкость = остаток + carry + base', () => {
  const rows = [row({ id: 'i1', remaining: 40, name: 'Геотекстиль' })];
  const caps = capacitiesOf(rows, new Map([['i1', 10]]));
  const lines = aggregateScheduleLines(rows, caps, new Map([['A', 25]]));
  assert.deepEqual(lines, [{ aggKey: 'A', name: 'Геотекстиль', unit: 'м2', quantity: 75 }]);
});

test('предзаполнение: недатированный остаток даёт запись с пустой датой', () => {
  const rows = [
    row({ id: 'i1', date: '2026-07-30', remaining: 100 }),
    row({ id: 'i2', date: null, remaining: 40 }),
  ];
  const caps = capacitiesOf(rows);
  assert.deepEqual(prefillFromRows(rows, caps), {
    A: [{ deliveryDate: '2026-07-30', quantity: 100 }, { deliveryDate: null, quantity: 40 }],
  });
});

test('предзаполнение: позиции одной даты складываются', () => {
  const rows = [
    row({ id: 'i1', date: '2026-07-30', remaining: 100 }),
    row({ id: 'i2', date: '2026-07-30', remaining: 50 }),
  ];
  assert.deepEqual(prefillFromRows(rows, capacitiesOf(rows)), {
    A: [{ deliveryDate: '2026-07-30', quantity: 150 }],
  });
});

test('нормализация: доли меньше кванта отбрасываются вместе с пустыми материалами', () => {
  const out = normalizeSchedule([
    { aggKey: 'A', entries: [{ deliveryDate: '2026-07-30', quantity: 0.00004 }] },
    { aggKey: 'B', entries: [{ deliveryDate: '2026-07-30', quantity: 1.000049 }] },
  ]);
  assert.deepEqual(out, [{ aggKey: 'B', entries: [{ deliveryDate: '2026-07-30', quantity: 1 }] }]);
});
