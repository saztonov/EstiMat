/**
 * Контракт отказа «материалы заявки в активной закупке» (409 при удалении заявки).
 * Прикрывает те же три стыка, на которых уже ломался OVERPLACED: сервер кладёт code+data,
 * обёртка пробрасывает только их, модалка читает разобранную схемой нагрузку.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestInPurchase } from './requestInPurchase.js';
import { ApiError } from '../../services/apiError.js';
import { REQUEST_IN_PURCHASE_CODE, type BlockingOrder } from '@estimat/shared';

const order: BlockingOrder = {
  id: '0eb018af-e357-43e2-af31-7929d4178e36',
  number: 'З-002',
  status: 'awarded',
  procurementMethod: 'manual',
  supplier: 'АО «ЕВРАЗ МАРКЕТ»',
};

/** Ровно то, что отправляет сервер. */
const realError = () =>
  new ApiError(409, 'Материалы заявки находятся в активных закупках: заказ З-002 …', {
    code: REQUEST_IN_PURCHASE_CODE,
    data: { orders: [order] },
  });

test('нагрузка сервера доходит до кода модалки', () => {
  assert.deepEqual(parseRequestInPurchase(realError()), [order]);
});

test('список в КОРНЕ тела не принимается', () => {
  const e = new ApiError(409, 'x', { code: REQUEST_IN_PURCHASE_CODE });
  (e as unknown as { orders: unknown }).orders = [order];
  assert.equal(parseRequestInPurchase(e), null);
});

test('другой 409 не путается с блокировкой', () => {
  const occ = new ApiError(409, 'Заявка изменена', { code: 'CONFLICT', data: { rowVersion: 7 } });
  assert.equal(parseRequestInPurchase(occ), null);
});

test('чужие ошибки игнорируются', () => {
  assert.equal(parseRequestInPurchase(new Error('сеть')), null);
  assert.equal(parseRequestInPurchase(null), null);
  assert.equal(parseRequestInPurchase(new ApiError(500, 'Ошибка сервера')), null);
});

test('битая нагрузка не роняет обработчик', () => {
  for (const data of [{}, { orders: [] }, { orders: [{ id: 'нет-uuid' }] }, 'строка']) {
    assert.equal(parseRequestInPurchase(new ApiError(409, 'x', { code: REQUEST_IN_PURCHASE_CODE, data })), null);
  }
});
