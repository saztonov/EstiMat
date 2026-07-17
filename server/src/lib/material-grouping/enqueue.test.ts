// Отсев поводов для пересчёта группировки.
//
// Группировка ставится сама на изменение сметы. Первый отсев — по причине события: он бесплатный
// и не даёт гонять тяжёлый запрос состава сметы из-за комментария. Точный ответ даёт input_hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectsGrouping, decideSuppression } from './enqueue.js';

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

// Подавление автопостановки. Ставить расчёт сам себя не должен после того, как его остановили
// человеком, — из-за этого «Остановить» и не работала: отменённое задание воскресало через 1.5 с.
const HASH = 'hash-A';
const job = (over: Partial<{ status: string; input_hash: string; cancel_reason: string | null }> = {}) => ({
  status: 'ready',
  input_hash: HASH,
  cancel_reason: null,
  ...over,
});

test('ничего не мешает — ставим', () => {
  assert.equal(decideSuppression(null, false, HASH), null);
  assert.equal(decideSuppression(job(), false, HASH), null);
});

test('остановлено человеком — не ставим, даже если смету изменили', () => {
  // Именно в этом смысл паузы: «Остановить» жмут, когда шлюз штормит, и правка сметы не должна
  // возобновлять шторм.
  assert.equal(decideSuppression(job({ status: 'cancelled', cancel_reason: 'manual' }), true, HASH), 'manual_stop');
  assert.equal(decideSuppression(job({ input_hash: 'hash-B' }), true, HASH), 'manual_stop');
  assert.equal(decideSuppression(null, true, HASH), 'manual_stop');
});

test('попытки исчерпаны на том же входе — не ставим', () => {
  assert.equal(decideSuppression(job({ status: 'dead' }), false, HASH), 'terminal_failure');
});

test('попытки исчерпаны, но смета изменилась — пробуем снова', () => {
  // Иначе один шторм 503 убил бы группировку сметы до ручного вмешательства.
  assert.equal(decideSuppression(job({ status: 'dead', input_hash: 'hash-B' }), false, HASH), null);
});

test('служебная отмена задания — не повод молчать', () => {
  // decideOnActive гасит протухшее задание и тут же ставит новое: это шаг замены, а не воля админа.
  assert.equal(decideSuppression(job({ status: 'cancelled', cancel_reason: 'superseded' }), false, HASH), null);
});

test('старая отмена без причины (до этой версии) автопостановку не блокирует', () => {
  // Признак остановки теперь — строка паузы; отмены, накопленные раньше, паузы не создавали.
  assert.equal(decideSuppression(job({ status: 'cancelled', cancel_reason: null }), false, HASH), null);
});
