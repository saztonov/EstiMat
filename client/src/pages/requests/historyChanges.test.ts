// Разбор поля changes записи истории заявки. Логика чистая — проверяем именно её, потому что
// именно здесь раньше была дыра: сервер писал комментарии, а интерфейс их не показывал.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeChanges } from './historyChanges';

test('история: комментарий доработки становится видимым', () => {
  const d = describeChanges('revision_requested', { comment: '  Уточните марку бетона  ' });
  assert.equal(d?.quote, 'Уточните марку бетона');
});

test('история: причина отмены показывается так же, как комментарий', () => {
  assert.equal(describeChanges('cancelled', { reason: 'Дубль заявки' })?.quote, 'Дубль заявки');
});

test('история: смена статуса переводится в подписи', () => {
  const d = describeChanges('status_changed', { from: 'in_work', to: 'supplier_selected' });
  assert.deepEqual(d?.facts, ['Из «В работе» в «Выбран поставщик»']);
});

test('история: правка объёмов показывает переходы и сворачивает длинный список', () => {
  const items = [
    { name: 'Кирпич', from: '10', to: '8' },
    { name: 'Песок', from: '5', to: '7' },
    { name: 'Щебень', from: '1', to: '2' },
    { name: 'Цемент', from: '3', to: '4' },
  ];
  const d = describeChanges('items_quantity_updated', { comment: 'Уточнение', items });
  assert.equal(d?.quote, 'Уточнение');
  assert.deepEqual(d?.facts, ['Кирпич: 10 → 8', 'Песок: 5 → 7', 'Щебень: 1 → 2', 'и ещё 1']);
});

test('история: перезаказ помечается отдельно', () => {
  const d = describeChanges('items_quantity_updated', {
    comment: 'Снижение', items: [{ name: 'Кирпич', from: '10', to: '2' }],
    overplaced: [{ itemId: 'x', placed: 5 }],
  });
  assert.equal(d?.warn, 'перезаказ: 1');
});

test('история: пустое и неизвестное не рендерится (сырой JSON показывать нельзя)', () => {
  assert.equal(describeChanges('created', {}), null);
  assert.equal(describeChanges('created', null), null);
  assert.equal(describeChanges('file_added', { docType: 'invoice' }), null);
});
