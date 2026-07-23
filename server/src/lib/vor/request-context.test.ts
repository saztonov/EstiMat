import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRequestVors, type VorContextRow } from './request-context.js';

const row = (vorId: string, fromItems: boolean): VorContextRow => ({
  vorId,
  vorName: `ВОР ${vorId}`,
  contractNumber: '12-05',
  contractDate: '2026-07-01',
  fromItems,
  facets: { locations: [], types: [] },
});

test('связанные со строками ВОР показываются без фолбэка', () => {
  const res = pickRequestVors([row('a', true), row('b', false), row('c', true)]);
  assert.equal(res.matched, 'items');
  assert.deepEqual(res.vors.map((v) => v.vorId), ['a', 'c']);
});

test('без связи со строками — ВОР, связанные с подрядчиком договором', () => {
  const res = pickRequestVors([row('a', false), row('b', false)]);
  assert.equal(res.matched, 'estimate');
  assert.deepEqual(res.vors.map((v) => v.vorId), ['a', 'b']);
});

test('ВОР без реквизитов договора не теряется: назначение старого типа', () => {
  const noContract: VorContextRow = { ...row('a', true), contractNumber: null, contractDate: null };
  const res = pickRequestVors([noContract]);
  assert.equal(res.matched, 'items');
  assert.deepEqual(res.vors.map((v) => v.vorId), ['a']);
});

test('у подрядчика нет ни связанных строк, ни договоров — пустой список, а не ошибка', () => {
  const res = pickRequestVors([]);
  assert.equal(res.matched, 'estimate');
  assert.deepEqual(res.vors, []);
});
