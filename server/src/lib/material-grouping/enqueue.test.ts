// Отсев поводов для пересчёта группировки.
//
// Группировка ставится сама на изменение сметы. Первый отсев — по причине события: он бесплатный
// и не даёт гонять тяжёлый запрос состава сметы из-за комментария. Точный ответ даёт input_hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectsGrouping } from './enqueue.js';

test('состав сметы изменился — пересчитываем', () => {
  for (const reason of [
    'material_created',
    'material_updated',
    'material_deleted',
    'materials_reassigned',
    'item_created',
    'item_updated',
    'item_deleted',
    'bulk_deleted',
    'ai_applied',
    'items_replicated',
    'undo_applied',
    'vor_created',
  ] as const) {
    assert.equal(affectsGrouping(reason), true, reason);
  }
});

test('назначение подрядчика — повод: до него группировать было нечего', () => {
  assert.equal(affectsGrouping('contractor_set'), true);
  assert.equal(affectsGrouping('contractor_cleared'), true);
});

test('на состав материалов не влияет — до модели дело не доходит', () => {
  for (const reason of ['comment_created', 'comment_updated', 'comment_deleted', 'estimate_updated'] as const) {
    assert.equal(affectsGrouping(reason), false, reason);
  }
});
