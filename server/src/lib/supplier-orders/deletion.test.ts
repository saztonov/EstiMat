/**
 * Гвард удаления лота (orderDeletionDenial) — единственная точка решения для
 * DELETE /supplier-orders/:id. Тест закрепляет матрицу: временный режим
 * (TEMP_ALLOW_ANY_STATUS_ORDER_DELETE) открывает не-forming статусы только админу и только для
 * нетендерных заказов; внешний тендер и незавершённый outbox блокируют удаление всегда.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { orderDeletionDenial, type OrderDeletionInput } from './helpers.js';

function input(overrides: Partial<OrderDeletionInput> = {}): OrderDeletionInput {
  return {
    sourcingStatus: 'forming',
    procurementMethod: 'manual',
    tenderPortalId: null,
    hasPendingOutbox: false,
    userRole: 'admin',
    tempAnyStatusAllowed: false,
    ...overrides,
  };
}

test('forming удаляется любой внутренней ролью без флага', () => {
  assert.equal(orderDeletionDenial(input({ userRole: 'engineer' })), null);
  assert.equal(orderDeletionDenial(input({ userRole: 'admin' })), null);
});

test('не-forming без флага — отказ даже админу', () => {
  for (const status of ['sourcing', 'approval', 'awarded', 'cancel_pending', 'cancelled', 'no_award']) {
    assert.match(orderDeletionDenial(input({ sourcingStatus: status })) ?? '', /формируемый/);
  }
});

test('временный режим: admin удаляет нетендерный заказ в любом статусе', () => {
  for (const status of ['sourcing', 'approval', 'awarded', 'cancelled']) {
    assert.equal(
      orderDeletionDenial(input({ sourcingStatus: status, tempAnyStatusAllowed: true })),
      null,
    );
  }
});

test('временный режим: engineer/manager не получают доступа к не-forming', () => {
  for (const role of ['engineer', 'manager']) {
    assert.match(
      orderDeletionDenial(input({ sourcingStatus: 'awarded', tempAnyStatusAllowed: true, userRole: role })) ?? '',
      /формируемый/,
    );
  }
});

test('временный режим: тендерный заказ не удаляется даже админом', () => {
  assert.match(
    orderDeletionDenial(input({
      sourcingStatus: 'awarded', procurementMethod: 'tender', tempAnyStatusAllowed: true,
    })) ?? '',
    /формируемый/,
  );
});

test('внешний тендер (tender_portal_id) блокирует всегда, включая временный режим', () => {
  assert.match(
    orderDeletionDenial(input({ sourcingStatus: 'awarded', tenderPortalId: 'T-1', tempAnyStatusAllowed: true })) ?? '',
    /внешний тендер/,
  );
  assert.match(orderDeletionDenial(input({ tenderPortalId: 'T-1' })) ?? '', /внешний тендер/);
});

test('незавершённый outbox блокирует всегда, включая временный режим', () => {
  assert.match(
    orderDeletionDenial(input({ sourcingStatus: 'awarded', hasPendingOutbox: true, tempAnyStatusAllowed: true })) ?? '',
    /незавершённые операции/,
  );
  assert.match(orderDeletionDenial(input({ hasPendingOutbox: true })) ?? '', /незавершённые операции/);
});
