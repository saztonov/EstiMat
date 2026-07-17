// Решения о постановке расчёта группировки.
//
// Расчёт ставится по открытию раздела и не чаще, чем разрешает задержка. Оба решения — чистые
// функции: они дорогие по последствиям (токены, шторм на шлюзе), а проверить их на живой БД в
// этом проекте негде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideCooldown, decideSuppression } from './enqueue.js';

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

// Задержка между прогонами. Ограничивает частоту трат: смету правят весь день, и без задержки
// каждый заход в раздел после каждой правки оплачивал бы полный прогон всех наборов.
const COOLDOWN = 30 * 60_000;
const NOW = new Date('2026-07-17T12:00:00Z').getTime();
const ready = (minutesAgo: number, status = 'ready') => ({
  status,
  created_at: new Date(NOW - minutesAgo * 60_000),
});

test('прошлый прогон свежий — ждём, и говорим до каких пор', () => {
  const until = decideCooldown(ready(10), NOW, COOLDOWN);
  assert.ok(until, 'ожидалась задержка');
  // Отсчёт от старта прошлого прогона: 10 минут прошло, ждать ещё 20.
  assert.equal(until.getTime() - NOW, 20 * 60_000);
});

test('прошлый прогон давно — ставим', () => {
  assert.equal(decideCooldown(ready(31), NOW, COOLDOWN), null);
  // Ровно на границе окна ждать уже нечего.
  assert.equal(decideCooldown(ready(30), NOW, COOLDOWN), null);
});

test('заданий ещё не было — ставим', () => {
  assert.equal(decideCooldown(null, NOW, COOLDOWN), null);
});

test('прошлый прогон не досчитал — задержка не действует', () => {
  // Иначе задержка подменяла бы decideSuppression: у dead и остановленных свои правила, а
  // законный повтор на новом составе сметы ждал бы полчаса без причины.
  for (const status of ['dead', 'cancelled', 'pending', 'running'] as const) {
    assert.equal(decideCooldown(ready(1, status), NOW, COOLDOWN), null, status);
  }
});

test('created_at приходит строкой — считаем так же', () => {
  // pg отдаёт timestamptz как Date, но задание может прийти и из JSON (журнал, тесты).
  const until = decideCooldown({ status: 'ready', created_at: new Date(NOW - 60_000).toISOString() }, NOW, COOLDOWN);
  assert.equal(until?.getTime(), NOW + 29 * 60_000);
});
