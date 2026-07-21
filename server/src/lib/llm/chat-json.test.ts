/**
 * Выжимка мультимодального сообщения для журнала вызовов.
 *
 * Тест существует ради одного правила: содержимое файла в журнал попадать НЕ должно. Base64
 * бесполезен для разбора и мгновенно упирается в лимит текста записи (1 МиБ), вытесняя сам
 * промпт — то есть ровно то, ради чего журнал и заведён.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeParts } from './chat-json.js';

const base64 = 'A'.repeat(4096); // ~3 КБ полезных данных

test('текстовые части попадают в журнал как есть', () => {
  assert.equal(
    summarizeParts([{ type: 'text', text: 'Разбери счёт' }, { type: 'text', text: '/no_think' }]),
    'Разбери счёт\n/no_think',
  );
});

test('содержимое файла заменяется описанием, а не пишется в журнал', () => {
  const out = summarizeParts([
    { type: 'text', text: 'Счёт во вложении' },
    { type: 'file', file: { filename: 'Счёт_1024.pdf', file_data: `data:application/pdf;base64,${base64}` } },
  ]);
  assert.match(out, /\[файл: Счёт_1024\.pdf, ~\d+ КБ\]/);
  assert.ok(!out.includes(base64), 'base64 не должен попадать в журнал');
});

test('изображение описывается своим типом, без данных', () => {
  const out = summarizeParts([
    { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
  ]);
  assert.match(out, /\[изображение: image\/png, ~\d+ КБ\]/);
  assert.ok(!out.includes(base64));
});

test('внешняя ссылка на изображение сохраняется — по ней вызов можно воспроизвести', () => {
  assert.equal(
    summarizeParts([{ type: 'image_url', image_url: { url: 'https://example.test/a.png' } }]),
    '[изображение: https://example.test/a.png]',
  );
});
