// Тексты состояний умной группировки.
//
// Жалоба, с которой всё началось: «Обработано 0 из 57 наборов», 0%, и непонятно, происходит ли
// хоть что-то. Эти строки и есть ответ, поэтому проверяем их прямо.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupingActivity, GroupingProgress } from '@estimat/shared';
import { activityText, formatCountdown, formatElapsed, retryText, suppressedNotice } from './smartGroupingText.js';

const NOW = Date.parse('2026-07-17T08:00:00Z');
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

const activity = (over: Partial<GroupingActivity> = {}): GroupingActivity => ({
  stage: 'in_progress',
  batchNumber: 3,
  httpAttempt: 1,
  lastHttpStatus: null,
  since: ago(42),
  ...over,
});

const progress = (over: Partial<GroupingProgress> = {}): GroupingProgress => ({
  id: 'job-1',
  status: 'running',
  batchesDone: 0,
  batchesTotal: 57,
  attempts: 1,
  maxAttempts: 3,
  lastError: null,
  nextRunAt: null,
  activity: null,
  ...over,
});

test('длительность: секунды и минуты', () => {
  assert.equal(formatElapsed(42_000), '42 с');
  assert.equal(formatElapsed(185_000), '3 мин 05 с');
  assert.equal(formatElapsed(0), '0 с');
});

test('обратный отсчёт: прошедшее время не показываем', () => {
  assert.equal(formatCountdown(new Date(NOW + 45_000).toISOString(), NOW), 'через 45 с');
  assert.equal(formatCountdown(new Date(NOW - 5_000).toISOString(), NOW), null);
  assert.equal(formatCountdown(null, NOW), null);
});

test('запрос отправлен — видно, что ждём ответ, и сколько уже', () => {
  assert.equal(activityText(activity(), NOW), 'Набор 3 — запрос отправлен, ждём ответ (42 с)');
});

test('отказ шлюза виден прямо в плашке, а не только в журнале', () => {
  // Ровно тот случай, что был в проде: 503 по кругу, а на экране немые 0%.
  assert.equal(
    activityText(activity({ lastHttpStatus: 503, httpAttempt: 3 }), NOW),
    'Набор 3 — ИИ-шлюз вернул 503, попытка 3 из 5 (42 с)',
  );
});

test('очередь к серверу модели и подготовка запроса различимы', () => {
  assert.equal(activityText(activity({ stage: 'waiting_slot' }), NOW), 'Набор 3 — ждём очереди к серверу модели (42 с)');
  assert.equal(activityText(activity({ stage: 'queued' }), NOW), 'Набор 3 — готовим запрос');
});

test('слияние групп подписано по-человечески, а не «набор null»', () => {
  assert.equal(activityText(activity({ batchNumber: null }), NOW), 'Слияние групп — запрос отправлен, ждём ответ (42 с)');
});

test('вызова нет — строки нет', () => {
  assert.equal(activityText(null, NOW), null);
});

test('первая попытка без ошибок — про повторы молчим', () => {
  assert.equal(retryText(progress(), NOW), null);
});

test('повторная попытка: номер, время следующей и причина', () => {
  const text = retryText(
    progress({ status: 'pending', attempts: 2, lastError: 'ИИ-шлюз вернул 503', nextRunAt: new Date(NOW + 45_000).toISOString() }),
    NOW,
  );
  assert.equal(text, 'Попытка 2 из 3 · повтор через 45 с · ИИ-шлюз вернул 503');
});

test('остановлено человеком — не обещаем автоматический пересчёт', () => {
  const n = suppressedNotice('manual_stop', null);
  assert.equal(n.message, 'Пересчёт остановлен');
  assert.match(n.description, /Правки сметы пересчёт не возобновят/);
  assert.doesNotMatch(n.description, /запустится автоматически/);
});

test('попытки исчерпаны — показываем причину', () => {
  const n = suppressedNotice('terminal_failure', {
    id: 'j',
    status: 'dead',
    error: 'ИИ-шлюз вернул 503',
    attempts: 3,
    stoppedByUser: false,
  });
  assert.equal(n.type, 'error');
  assert.match(n.description, /ИИ-шлюз вернул 503/);
});

test('ничего не подавлено — прежнее обещание автопересчёта остаётся правдой', () => {
  const n = suppressedNotice(null, null);
  assert.equal(n.message, 'Результат устарел и будет пересчитан');
  assert.match(n.description, /запустится автоматически/);
});
