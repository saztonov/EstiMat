// Договорная цена в кабинете подрядчика: своя — видна, чужая — снята, мета — всегда убрана.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractorPriceView } from './contractorPriceView.js';

const ME = 'org-me';
const OTHER = 'org-other';

/** Полная строка с договорной ценой и служебной метой — как приходит из estimate_items/em.*. */
const rowWith = (owner: string | null, price: string | null = '100.00', total: string | null = '200.00') => ({
  id: 'i1',
  description: 'Монтаж',
  unit: 'шт',
  quantity: '2',
  unit_price: '50.00',
  total: '100.00',
  contract_unit_price: price,
  contract_total: total,
  contract_price_contractor_id: owner,
  contract_price_vor_id: 'vor-1',
  contract_price_updated_at: '2026-07-24T00:00:00Z',
  contract_price_updated_by: 'user-1',
});

test('своя договорная цена остаётся', () => {
  const out = contractorPriceView(rowWith(ME), ME);
  assert.equal(out.contract_unit_price, '100.00');
  assert.equal(out.contract_total, '200.00');
});

test('чужая договорная цена снимается', () => {
  const out = contractorPriceView(rowWith(OTHER), ME);
  assert.equal(out.contract_unit_price, null);
  assert.equal(out.contract_total, null);
});

test('осиротевшая цена (владелец не указан) снимается', () => {
  const out = contractorPriceView(rowWith(null), ME);
  assert.equal(out.contract_unit_price, null);
  assert.equal(out.contract_total, null);
});

test('своей цены ещё нет (ВОР не заполнен) — остаётся null, а не исчезает', () => {
  const out = contractorPriceView(rowWith(ME, null, null), ME);
  assert.equal(out.contract_unit_price, null);
  assert.equal(out.contract_total, null);
});

test('служебная мета договорной цены вырезается всегда — и у владельца, и у чужого', () => {
  for (const owner of [ME, OTHER, null]) {
    const out = contractorPriceView(rowWith(owner), ME) as Record<string, unknown>;
    assert.ok(!('contract_price_vor_id' in out), 'vor_id не должен уходить подрядчику');
    assert.ok(!('contract_price_contractor_id' in out), 'владелец цены не должен уходить подрядчику');
    assert.ok(!('contract_price_updated_at' in out));
    assert.ok(!('contract_price_updated_by' in out));
  }
});

test('прочие поля строки не трогаются', () => {
  const out = contractorPriceView(rowWith(ME), ME);
  assert.equal(out.description, 'Монтаж');
  assert.equal(out.unit_price, '50.00');
  assert.equal(out.total, '100.00');
});

test('исходный объект не мутируется', () => {
  const src = rowWith(OTHER);
  contractorPriceView(src, ME);
  assert.equal(src.contract_unit_price, '100.00', 'вход остаётся прежним — правится только копия');
  assert.equal(src.contract_price_contractor_id, OTHER);
});
