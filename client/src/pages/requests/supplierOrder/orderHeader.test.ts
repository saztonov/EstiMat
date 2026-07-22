import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryWindowOf, invoiceLabel, invoicesOf, primaryActionOf, isCompositionEditable, orderNumberOf,
} from './orderHeader.js';
import type { SupplierOrderDetail, OrderInvoice } from '../types.js';

/** Минимальный заказ: тестам нужны считанные поля, остальное к правилам шапки отношения не имеет. */
const order = (patch: Partial<SupplierOrderDetail> = {}) => ({
  sourcing_status: 'forming',
  procurement_method: 'manual',
  deliverySchedule: [],
  invoices: [],
  ...patch,
} as unknown as SupplierOrderDetail);

const invoice = (patch: Partial<OrderInvoice> = {}) => ({
  id: 'i1', invoice_revision: 1, invoice_no: null, invoice_date: null,
  amount: null, vat_amount: null, supplier_name: null, supplier_inn: null,
  source: 'manual', file_name: null, file_size: null, note: null,
  superseded_at: null, superseded_reason: null, created_at: '2026-07-01', uploaded_by_name: null,
  ...patch,
} as OrderInvoice);

test('номер заказа: три разряда, без номера — З-000', () => {
  assert.equal(orderNumberOf(3), 'З-003');
  assert.equal(orderNumberOf(142), 'З-142');
  assert.equal(orderNumberOf(1234), 'З-1234'); // четырёхзначные не режем
  assert.equal(orderNumberOf(null), 'З-000');
});

test('окно поставок: границы по крайним датам, повторы не считаются дважды', () => {
  const w = deliveryWindowOf(order({
    deliverySchedule: [
      { agg_key: 'A', delivery_date: '2026-08-10', quantity: 1 },
      { agg_key: 'B', delivery_date: '2026-08-01', quantity: 2 },
      { agg_key: 'C', delivery_date: '2026-08-10', quantity: 3 },
    ],
  }));
  assert.deepEqual(w, { from: '2026-08-01', to: '2026-08-10', dates: 2 });
});

test('окно поставок: без графика — null, а не пустой диапазон', () => {
  assert.equal(deliveryWindowOf(order()), null);
});

test('подпись счёта: номер с датой, только номер, иначе имя файла', () => {
  assert.equal(invoiceLabel({ invoice_no: '123', invoice_date: '2026-07-01', file_name: 'x.pdf' }), 'Счёт № 123 от 01.07.2026');
  assert.equal(invoiceLabel({ invoice_no: '123', invoice_date: null, file_name: 'x.pdf' }), 'Счёт № 123');
  // Реквизиты ещё не заполнены — пользователь всё равно должен опознать документ.
  assert.equal(invoiceLabel({ invoice_no: null, invoice_date: null, file_name: 'Счёт_ООО.pdf' }), 'Счёт_ООО.pdf');
  assert.equal(invoiceLabel({ invoice_no: null, invoice_date: null, file_name: null }), 'Счёт без номера');
});

test('счета: действующие идут раньше замещённых', () => {
  const list = invoicesOf(order({
    invoices: [
      invoice({ id: 'old', invoice_no: '1', superseded_at: '2026-07-05', superseded_reason: 'replaced' }),
      invoice({ id: 'new', invoice_no: '2' }),
    ],
  }));
  assert.deepEqual(list.map((i) => i.id), ['new', 'old']);
  assert.equal(list[0]!.superseded, false);
  assert.equal(list[1]!.superseded, true);
});

test('главное действие по стадиям', () => {
  assert.equal(primaryActionOf(null, false).key, 'create');
  assert.equal(primaryActionOf(order({ sourcing_status: 'forming' }), false).key, 'freeze');
  assert.equal(primaryActionOf(order({ sourcing_status: 'sourcing' }), false).key, 'submit');
  assert.equal(primaryActionOf(order({ sourcing_status: 'awarded' }), true).key, 'none');
  assert.equal(primaryActionOf(order({ sourcing_status: 'cancelled' }), true).key, 'none');
});

test('на согласовании кнопка только у того, кто согласует', () => {
  const o = order({ sourcing_status: 'approval' });
  assert.equal(primaryActionOf(o, true).key, 'approve');
  // Инженер, отправивший предложение, ждёт решения — предлагать ему нечего.
  assert.equal(primaryActionOf(o, false).key, 'none');
});

test('тендер ведёт площадка — ручного главного действия нет ни на одной стадии', () => {
  for (const status of ['forming', 'sourcing', 'approval', 'awarded']) {
    assert.equal(primaryActionOf(order({ sourcing_status: status, procurement_method: 'tender' }), true).key, 'none');
  }
});

test('состав правится только до фиксации', () => {
  assert.equal(isCompositionEditable(order({ sourcing_status: 'forming' })), true);
  for (const status of ['sourcing', 'approval', 'awarded', 'cancelled', 'no_award']) {
    assert.equal(isCompositionEditable(order({ sourcing_status: status })), false, status);
  }
  assert.equal(isCompositionEditable(null), false);
});
