import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterVorScope, type VorAssignFilters, type VorScopeItem } from './vor.js';

const CAT_A = '11111111-1111-4111-8111-111111111111';
const CAT_B = '11111111-1111-4111-8111-111111111112';
const TYPE_A = '22222222-2222-4222-8222-222222222221';
const TYPE_B = '22222222-2222-4222-8222-222222222222';
const ZONE_1 = '33333333-3333-4333-8333-333333333331';
const ZONE_2 = '33333333-3333-4333-8333-333333333332';
const LT_A = '44444444-4444-4444-8444-444444444441';

const noFilters: VorAssignFilters = { categoryIds: [], typeIds: [], zoneIds: [], locationTypeIds: [] };

const item = (id: string, over: Partial<VorScopeItem> = {}): VorScopeItem => ({
  itemId: id,
  description: `Работа ${id}`,
  snapshotLocationLabel: null,
  snapshotTypeName: null,
  costCategoryId: CAT_A,
  costCategoryName: 'Категория А',
  costTypeId: TYPE_A,
  costTypeName: 'Вид А',
  zones: [{ id: ZONE_1, name: 'Корпус 1' }],
  locationTypeId: LT_A,
  locationTypeName: 'Тип А',
  assignedContractorIds: [],
  requestLocked: false,
  state: 'unchanged',
  ...over,
});

const ids = (rows: VorScopeItem[]) => rows.map((r) => r.itemId).sort();

test('весь ВОР: живые строки целиком, фильтры не смотрим', () => {
  const items = [
    item('a'),
    item('b', { costCategoryId: CAT_B, zones: [] }),
    item('c', { state: 'deleted' }),
  ];
  const res = filterVorScope(items, 'all', { ...noFilters, categoryIds: [CAT_A] });
  assert.deepEqual(ids(res), ['a', 'b']);
});

test('удалённая из сметы строка не назначается и при отборах', () => {
  const items = [item('a'), item('b', { state: 'deleted' })];
  assert.deepEqual(ids(filterVorScope(items, 'filters', noFilters)), ['a']);
});

test('изменённая после выгрузки строка назначается', () => {
  const items = [item('a', { state: 'changed' })];
  assert.deepEqual(ids(filterVorScope(items, 'filters', noFilters)), ['a']);
});

test('пустые фильтры = «все»: тот же набор, что и «весь ВОР»', () => {
  const items = [item('a'), item('b', { costTypeId: TYPE_B })];
  assert.deepEqual(
    ids(filterVorScope(items, 'filters', noFilters)),
    ids(filterVorScope(items, 'all', noFilters)),
  );
});

test('внутри одного фильтра — ИЛИ', () => {
  const items = [
    item('a', { costTypeId: TYPE_A }),
    item('b', { costTypeId: TYPE_B }),
    item('c', { costTypeId: null }),
  ];
  const res = filterVorScope(items, 'filters', { ...noFilters, typeIds: [TYPE_A, TYPE_B] });
  assert.deepEqual(ids(res), ['a', 'b']);
});

test('между фильтрами — И', () => {
  const items = [
    item('a', { costCategoryId: CAT_A, costTypeId: TYPE_A }),
    item('b', { costCategoryId: CAT_A, costTypeId: TYPE_B }),
    item('c', { costCategoryId: CAT_B, costTypeId: TYPE_A }),
  ];
  const res = filterVorScope(items, 'filters', {
    ...noFilters,
    categoryIds: [CAT_A],
    typeIds: [TYPE_A],
  });
  assert.deepEqual(ids(res), ['a']);
});

test('локации: несколько зон в отборе, строка проходит по любой своей зоне', () => {
  const items = [
    item('a', { zones: [{ id: ZONE_1, name: 'Корпус 1' }] }),
    item('b', { zones: [{ id: ZONE_2, name: 'Корпус 2' }] }),
    item('c', { zones: [{ id: ZONE_1, name: 'Корпус 1' }, { id: ZONE_2, name: 'Корпус 2' }] }),
    item('d', { zones: [] }),
  ];
  assert.deepEqual(ids(filterVorScope(items, 'filters', { ...noFilters, zoneIds: [ZONE_2] })), ['b', 'c']);
  assert.deepEqual(
    ids(filterVorScope(items, 'filters', { ...noFilters, zoneIds: [ZONE_1, ZONE_2] })),
    ['a', 'b', 'c'],
  );
});

test('«Без ...» отбирает строки с незаполненным значением — и только их', () => {
  const items = [
    item('a'),
    item('b', { costCategoryId: null, costCategoryName: null }),
    item('c', { zones: [] }),
    item('d', { locationTypeId: null, locationTypeName: null }),
  ];
  assert.deepEqual(ids(filterVorScope(items, 'filters', { ...noFilters, categoryIds: ['none'] })), ['b']);
  assert.deepEqual(ids(filterVorScope(items, 'filters', { ...noFilters, zoneIds: ['none'] })), ['c']);
  assert.deepEqual(
    ids(filterVorScope(items, 'filters', { ...noFilters, locationTypeIds: ['none'] })),
    ['d'],
  );
});

test('«Без локации» вместе с конкретной зоной — обе группы разом', () => {
  const items = [
    item('a', { zones: [{ id: ZONE_1, name: 'Корпус 1' }] }),
    item('b', { zones: [{ id: ZONE_2, name: 'Корпус 2' }] }),
    item('c', { zones: [] }),
  ];
  const res = filterVorScope(items, 'filters', { ...noFilters, zoneIds: [ZONE_1, 'none'] });
  assert.deepEqual(ids(res), ['a', 'c']);
});

test('отбор, под который не подходит ни одна строка, даёт пустой набор', () => {
  const items = [item('a')];
  assert.deepEqual(filterVorScope(items, 'filters', { ...noFilters, categoryIds: [CAT_B] }), []);
});
