// Политика повторов к ИИ-шлюзу.
//
// Проверяется тестом, а не на живом шлюзе: ошибка здесь — это либо шторм отказов (повторяем то,
// что повторять нельзя), либо упавшее задание (не повторяем то, что прошло бы со второго раза).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_BACKOFF_MS,
  MAX_RETRY_AFTER_MS,
  canStartAttempt,
  classifyGatewayFailure,
  parseRetryAfterMs,
  retryDelayMs,
} from './retry-policy.js';

const NOW = Date.parse('2026-07-17T14:03:00Z');

test('лимиты и сбои шлюза — повторяем', () => {
  // 429/503 — лимиты прокси, 504 — его дедлайн 190 с, 500/502 — сбой выше по течению.
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(classifyGatewayFailure(status, '').retry, true, String(status));
  }
});

test('конфигурация и данные — не повторяем', () => {
  // Повтор даст ровно тот же ответ, только за деньги.
  for (const status of [400, 401, 403, 404, 413, 422, 501, 505]) {
    assert.equal(classifyGatewayFailure(status, '').retry, false, String(status));
  }
});

test('очередь прокси занята — это повод повторить', () => {
  const r = classifyGatewayFailure(503, '{"error":{"code":"queue_full"}}');
  assert.equal(r.retry, true);
  assert.equal(r.code, 'queue_full');
});

test('таблица дедупликации переполнена — тоже повторяем, тем же ключом', () => {
  assert.equal(classifyGatewayFailure(503, '{"error":{"code":"dedup_full"}}').retry, true);
});

test('код отказа важнее статуса', () => {
  // 400 сам по себе фатален, но именно код объясняет, что чинить.
  const r = classifyGatewayFailure(400, '{"error":{"code":"model_not_allowed"}}');
  assert.equal(r.retry, false);
  assert.equal(r.code, 'model_not_allowed');
});

test('тело — не JSON: решаем по статусу', () => {
  // 503 от nginx приходит с пустым телом или HTML-страницей, а не с нашим JSON.
  assert.equal(classifyGatewayFailure(503, '').retry, true);
  assert.equal(classifyGatewayFailure(503, '<html><body>503 Service Unavailable</body></html>').retry, true);
  assert.equal(classifyGatewayFailure(503, '{битый json').retry, true);
  assert.equal(classifyGatewayFailure(400, '{"error":{}}').retry, false);
});

test('Retry-After в секундах', () => {
  assert.equal(parseRetryAfterMs('10', NOW), 10_000);
  assert.equal(parseRetryAfterMs('0', NOW), 0);
});

test('Retry-After датой', () => {
  assert.equal(parseRetryAfterMs(new Date(NOW + 12_000).toUTCString(), NOW), 12_000);
});

test('дата в прошлом — ждать нечего', () => {
  assert.equal(parseRetryAfterMs(new Date(NOW - 60_000).toUTCString(), NOW), 0);
});

test('слишком большой Retry-After обрезаем', () => {
  // Иначе задание проспало бы час и упёрлось в дедлайн, ничего не посчитав.
  assert.equal(parseRetryAfterMs('3600', NOW), MAX_RETRY_AFTER_MS);
  assert.equal(parseRetryAfterMs(new Date(NOW + 3_600_000).toUTCString(), NOW), MAX_RETRY_AFTER_MS);
});

test('заголовка нет или он неразборчив', () => {
  assert.equal(parseRetryAfterMs(null, NOW), null);
  assert.equal(parseRetryAfterMs('', NOW), null);
  assert.equal(parseRetryAfterMs('скоро', NOW), null);
  // Дробные секунды спецификация не допускает — не выдумываем за отправителя.
  assert.equal(parseRetryAfterMs('1.5', NOW), null);
});

test('без Retry-After — растущая пауза с разбросом', () => {
  for (const attempt of [0, 1, 2, 3]) {
    const full = BASE_BACKOFF_MS * 2 ** attempt;
    assert.equal(retryDelayMs(attempt, null, () => 0), Math.round(full * 0.5), `${attempt} — низ`);
    assert.equal(retryDelayMs(attempt, null, () => 1), full, `${attempt} — верх`);
  }
});

test('Retry-After уважаем: разброс только вверх', () => {
  // Прийти раньше, чем просили, значит гарантированно получить второй отказ.
  assert.equal(retryDelayMs(0, 10_000, () => 0), 10_000);
  assert.equal(retryDelayMs(0, 10_000, () => 1), 12_000);
});

test('Retry-After важнее растущей паузы в обе стороны', () => {
  // Просят больше, чем дал бы backoff первой попытки…
  assert.equal(retryDelayMs(0, 10_000, () => 0), 10_000);
  // …и меньше, чем дал бы backoff последней.
  assert.equal(retryDelayMs(3, 2_000, () => 0), 2_000);
});

test('на попытку нужен весь её таймаут, а не остаток', () => {
  // Иначе отправим запрос, заведомо зная, что оборвём его раньше дедлайна прокси: это 499 в его
  // журнале и оплаченный ответ, который мы не прочитаем.
  assert.equal(canStartAttempt(NOW, NOW + 250_000, 200_000), true);
  assert.equal(canStartAttempt(NOW, NOW + 200_000, 200_000), true);
  assert.equal(canStartAttempt(NOW, NOW + 199_000, 200_000), false);
  assert.equal(canStartAttempt(NOW, NOW - 1000, 200_000), false);
});
