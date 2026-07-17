// Ограничители обращений к ИИ-шлюзу: темп отправок и потолок одновременных запросов.
//
// Тестируется арифметика, а не таймеры: reserveSlot принимает время параметром именно ради этого —
// тест на setTimeout мигал бы в CI, а проверить нужно ровно правило, по которому запросы
// разносятся во времени.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore, reserveSlot, type RateState } from './limiter.js';

const INTERVAL = 1500;

test('очередь отправок: каждая следующая — через интервал', () => {
  const state: RateState = { nextAt: 0 };
  // Пятеро пришли одновременно — уходят по одному, а не пачкой.
  const waits = [0, 0, 0, 0, 0].map(() => reserveSlot(state, 1_000_000, INTERVAL));
  assert.deepEqual(waits, [0, 1500, 3000, 4500, 6000]);
});

test('за простой кредит не копится', () => {
  // Иначе после спокойного часа накопленный запас выпустил бы пачку — ровно то, чего лимит и не
  // разрешает. Прошлое молчание права на всплеск не даёт.
  const state: RateState = { nextAt: 0 };
  reserveSlot(state, 1_000_000, INTERVAL);
  assert.equal(reserveSlot(state, 1_000_000 + 3_600_000, INTERVAL), 0);
  // И следующий за ним снова ждёт свой интервал, а не уходит следом.
  assert.equal(reserveSlot(state, 1_000_000 + 3_600_000, INTERVAL), INTERVAL);
});

test('редкие запросы не задерживаются', () => {
  const state: RateState = { nextAt: 0 };
  assert.equal(reserveSlot(state, 1_000_000, INTERVAL), 0);
  assert.equal(reserveSlot(state, 1_000_000 + INTERVAL, INTERVAL), 0);
});

test('темп укладывается в лимит прокси', () => {
  // Потолок прокси — 60 запросов в минуту. При интервале 1.5 с из очереди в сотню за первую
  // минуту уходит 40: запас есть даже если все они пришли одномоментно.
  const state: RateState = { nextAt: 0 };
  const start = 1_000_000;
  let sent = 0;
  for (let i = 0; i < 100; i++) {
    if (reserveSlot(state, start, INTERVAL) < 60_000) sent++;
  }
  assert.equal(sent, 40);
});

test('одновременно работает не больше потолка', () => {
  const sem = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const task = async () => {
    await sem.run(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
  };
  return Promise.all([task(), task(), task(), task(), task()]).then(() => {
    assert.equal(peak, 2);
  });
});

test('упавшая задача слот не забирает', async () => {
  // Без release в finally одна ошибка навсегда съедала бы слот, и при потолке 2 двух ошибок
  // хватило бы, чтобы остановить весь обмен с моделью.
  const sem = new Semaphore(1);
  await assert.rejects(sem.run(async () => Promise.reject(new Error('шлюз отказал'))));
  assert.equal(await sem.run(async () => 'слот свободен'), 'слот свободен');
});
