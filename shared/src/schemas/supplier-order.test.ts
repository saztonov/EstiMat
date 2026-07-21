import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { upsertOfferSchema } from './supplier-order.js';

/**
 * Свободная форма поставщика-предложения: строку заводят названием, комментарием или тем и другим.
 * Проверяем именно нормализацию: форма шлёт пустые строки, а не отсутствующие поля, и «поле из
 * пробелов» не должно считаться заполненным ни здесь, ни в БД (CHECK ... btrim, миграция 0081).
 */
describe('upsertOfferSchema', () => {
  it('принимает строку с одним комментарием', () => {
    const v = upsertOfferSchema.parse({ supplierName: '', note: 'прислали по почте' });
    assert.equal(v.supplierName, null);
    assert.equal(v.note, 'прислали по почте');
  });

  it('принимает строку с одним названием', () => {
    const v = upsertOfferSchema.parse({ supplierName: 'ООО Ромашка', note: '' });
    assert.equal(v.supplierName, 'ООО Ромашка');
    assert.equal(v.note, null);
  });

  it('обрезает пробелы по краям', () => {
    const v = upsertOfferSchema.parse({ supplierName: '  ООО Ромашка  ', note: '  КП от 20.07  ' });
    assert.equal(v.supplierName, 'ООО Ромашка');
    assert.equal(v.note, 'КП от 20.07');
  });

  it('отклоняет пустую форму', () => {
    assert.equal(upsertOfferSchema.safeParse({}).success, false);
  });

  it('отклоняет поля из одних пробелов', () => {
    assert.equal(upsertOfferSchema.safeParse({ supplierName: '   ', note: '  ' }).success, false);
  });

  it('оставляет привязку к справочнику и ИНН необязательными', () => {
    const v = upsertOfferSchema.parse({ supplierName: 'ООО Ромашка' });
    assert.equal(v.supplierId ?? null, null);
    assert.equal(v.supplierInn ?? null, null);
  });
});
