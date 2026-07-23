// Реквизиты договора «ВОР → подрядчик»: подпись и схлопывание одного договора, розданного
// на несколько ВОР.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeContracts, formatContractDate, formatContractLabel } from './contractLabel';

test('дата договора: YYYY-MM-DD → ДД.ММ.ГГГГ', () => {
  assert.equal(formatContractDate('2026-07-23'), '23.07.2026');
  assert.equal(formatContractDate(null), '', 'даты нет — пустая строка, а не «null»');
});

test('подпись договора: все четыре комбинации реквизитов', () => {
  assert.equal(formatContractLabel({ number: '123-05', date: '2026-07-23' }), '№ 123-05 от 23.07.2026');
  assert.equal(formatContractLabel({ number: '123-05', date: null }), '№ 123-05');
  assert.equal(formatContractLabel({ number: null, date: '2026-07-23' }), 'Без номера от 23.07.2026');
  assert.equal(formatContractLabel({ number: null, date: null }), 'Без номера');
});

test('введённый вручную знак № не удваивается', () => {
  assert.equal(formatContractLabel({ number: '№ 123-05', date: null }), '№ 123-05');
  assert.equal(formatContractLabel({ number: '№123-05', date: null }), '№ 123-05');
  assert.equal(formatContractLabel({ number: '  123-05  ', date: null }), '№ 123-05');
  assert.equal(formatContractLabel({ number: '   ', date: null }), 'Без номера', 'пробелы — это не номер');
});

test('один договор на нескольких ВОР схлопывается, порядок сохраняется', () => {
  const out = dedupeContracts([
    { number: '123-05', date: '2026-07-23' },
    { number: '98-04', date: '2026-05-12' },
    { number: '№ 123-05', date: '2026-07-23' },
  ]);
  assert.deepEqual(out, [
    { number: '123-05', date: '2026-07-23' },
    { number: '98-04', date: '2026-05-12' },
  ]);
});

test('тот же номер с другой датой — разные договоры', () => {
  const out = dedupeContracts([
    { number: '123-05', date: '2026-07-23' },
    { number: '123-05', date: '2026-08-01' },
    { number: '123-05', date: null },
  ]);
  assert.equal(out.length, 3);
});

test('договоры без номера не схлопываются — сравнивать их не с чем', () => {
  const out = dedupeContracts([
    { number: null, date: '2026-07-23' },
    { number: null, date: '2026-07-23' },
    { number: '', date: null },
  ]);
  assert.equal(out.length, 3);
});
