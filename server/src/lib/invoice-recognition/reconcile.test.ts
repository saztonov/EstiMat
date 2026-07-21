import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileInvoice, toCents, moneyTolerance, qtyMatches, normalizeName, diceSimilarity,
  type OrderSnapshot,
} from './reconcile.js';
import { normalizeNumericString, type RecognizedInvoice } from '@estimat/shared';

const order = (patch: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  lines: [{ aggKey: 'A', name: 'Кирпич керамический М150', unit: 'шт', quantity: '1000', unitPrice: '25.00' }],
  vatRatePercent: 22,
  amount: '30500.00',
  ...patch,
});

const invoice = (patch: Partial<RecognizedInvoice> = {}): RecognizedInvoice => ({
  documentType: 'invoice', invoiceNo: '1', invoiceDate: '2026-07-01',
  supplier: null, buyer: null, currency: 'RUB', vatMode: 'included', vatRate: 22,
  items: [{ lineNo: 1, name: 'Кирпич керамический М150', unit: 'шт', quantity: '1000', unitPrice: '25.00', amountNet: '25000.00', vatAmount: '5500.00', amountTotal: '30500.00' }],
  totals: { net: '25000.00', vat: '5500.00', total: '30500.00' },
  notes: null, confidence: 'high',
  ...patch,
} as RecognizedInvoice);

// ---- нормализация чисел из документа ----

test('числа из документа приводятся к десятичной строке', () => {
  assert.equal(normalizeNumericString('1 234,56 ₽'), '1234.56');
  assert.equal(normalizeNumericString('1 234.56'), '1234.56');
  assert.equal(normalizeNumericString('(1200)'), '-1200');  // бухгалтерская запись отрицательных
  assert.equal(normalizeNumericString('—'), null);
  assert.equal(normalizeNumericString(''), null);
  assert.equal(normalizeNumericString('не число'), null);
});

// ---- деньги в копейках ----

test('копейки не теряются на больших суммах', () => {
  // Через Number такое сложение уже даёт хвост: сравнивать деньги float нельзя.
  assert.equal(toCents('12345678.91'), 1234567891n);
  assert.equal(toCents('0.1'), 10n);
  assert.equal(toCents(null), null);
});

test('допуск — рубль или полпроцента, что больше', () => {
  assert.equal(moneyTolerance(toCents('1000.00')), 500n);        // 0.5% от 1000 ₽ = 5 ₽
  assert.equal(moneyTolerance(toCents('100.00')), 100n);         // мелкая сумма — рубль
  assert.equal(moneyTolerance(toCents('1000000.00')), 500000n);  // 0.5% от миллиона = 5000 ₽
  assert.equal(moneyTolerance(null), 100n);                      // сумма заказа неизвестна
});

// ---- сопоставление названий ----

test('нормализация убирает регистр, кавычки и ссылки на нормативы', () => {
  assert.equal(normalizeName('Кирпич «Керамик» ГОСТ 530-2012'), 'кирпич керамик');
  assert.equal(normalizeName('  ЦЕМЕНТ   М500  '), 'цемент м500');
});

test('схожесть: одинаковые названия совпадают, разные — нет', () => {
  assert.equal(diceSimilarity('кирпич', 'кирпич'), 1);
  assert.ok(diceSimilarity(normalizeName('Кирпич керамический М150'), normalizeName('Кирпич керамич. М150')) > 0.55);
  assert.ok(diceSimilarity(normalizeName('Кирпич'), normalizeName('Цемент М500')) < 0.55);
});

// ---- количества ----

test('количества сходятся с относительным допуском', () => {
  assert.equal(qtyMatches(1000, 1000), true);
  assert.equal(qtyMatches(1000, 1000.0005), true);
  assert.equal(qtyMatches(1000, 1100), false);
});

// ---- сверка целиком ----

test('совпадающий счёт даёт статус match без предупреждений', () => {
  const r = reconcileInvoice(order(), invoice());
  assert.equal(r.status, 'match');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.lines[0]!.status, 'ok');
});

test('расхождение суммы попадает в предупреждения, но остаётся warn — не блокировкой', () => {
  const r = reconcileInvoice(order(), invoice({ totals: { net: '25000.00', vat: '5500.00', total: '35000.00' } }));
  assert.equal(r.status, 'warn');
  assert.equal(r.totals[0]!.status, 'warn');
  assert.match(r.warnings.join(' '), /Сумма счёта отличается/);
});

test('копеечное расхождение округления не считается ошибкой', () => {
  const r = reconcileInvoice(order(), invoice({ totals: { net: '25000.00', vat: '5500.00', total: '30500.40' } }));
  assert.equal(r.totals[0]!.status, 'ok');
});

test('расхождение количества и цены отмечается построчно', () => {
  const rQty = reconcileInvoice(order(), invoice({
    items: [{ lineNo: 1, name: 'Кирпич керамический М150', unit: 'шт', quantity: '1200', unitPrice: '25.00', amountNet: null, vatAmount: null, amountTotal: null }],
  }));
  assert.equal(rQty.lines[0]!.status, 'qty_diff');

  const rPrice = reconcileInvoice(order(), invoice({
    items: [{ lineNo: 1, name: 'Кирпич керамический М150', unit: 'шт', quantity: '1000', unitPrice: '31.00', amountNet: null, vatAmount: null, amountTotal: null }],
  }));
  assert.equal(rPrice.lines[0]!.status, 'price_diff');
});

test('лишние и недостающие позиции не угадываются, а показываются как есть', () => {
  const r = reconcileInvoice(
    order({ lines: [
      { aggKey: 'A', name: 'Кирпич керамический М150', unit: 'шт', quantity: '1000', unitPrice: '25.00' },
      { aggKey: 'B', name: 'Цемент М500', unit: 'т', quantity: '5', unitPrice: '8000.00' },
    ] }),
    invoice({ items: [
      { lineNo: 1, name: 'Кирпич керамический М150', unit: 'шт', quantity: '1000', unitPrice: '25.00', amountNet: null, vatAmount: null, amountTotal: null },
      { lineNo: 2, name: 'Доставка', unit: 'усл', quantity: '1', unitPrice: '5000.00', amountNet: null, vatAmount: null, amountTotal: null },
    ] }),
  );
  assert.equal(r.lines.find((l) => l.orderName === 'Цемент М500')!.status, 'missing_in_invoice');
  assert.equal(r.lines.find((l) => l.invoiceName === 'Доставка')!.status, 'unmatched_invoice');
  assert.equal(r.status, 'warn');
});

test('позиция сопоставляется даже при слегка иной формулировке', () => {
  const r = reconcileInvoice(order(), invoice({
    items: [{ lineNo: 1, name: 'Кирпич керамический М150 ГОСТ 530-2012', unit: 'шт', quantity: '1000', unitPrice: '25.00', amountNet: null, vatAmount: null, amountTotal: null }],
  }));
  assert.equal(r.lines[0]!.status, 'ok');
  assert.ok((r.lines[0]!.matchScore ?? 0) >= 0.55);
});

test('счёт без НДС при облагаемом заказе — расхождение', () => {
  const r = reconcileInvoice(order(), invoice({ vatMode: 'none', vatRate: null }));
  assert.equal(r.vat.status, 'warn');
  assert.match(r.warnings.join(' '), /без НДС/);
});

test('иная ставка НДС отмечается', () => {
  const r = reconcileInvoice(order(), invoice({ vatRate: 20 }));
  assert.equal(r.vat.status, 'warn');
  assert.match(r.warnings.join(' '), /Ставка НДС/);
});

test('пустое распознавание не выдаёт ложных совпадений', () => {
  const r = reconcileInvoice(order(), invoice({ items: [], totals: null }));
  assert.equal(r.totals[0]!.status, 'unknown');
  assert.equal(r.lines[0]!.status, 'missing_in_invoice');
});
