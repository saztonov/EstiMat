/**
 * Контракт отказа «объём ниже уже заказанного». Тест существует именно потому, что прежняя
 * реализация была сломана на всех трёх стыках сразу (сервер клал в корень, обёртка отдавала
 * только data, модалка читала третье поле) — и ни один из них не был ничем прикрыт.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOverplaced } from './overplaced.js';
import { ApiError } from '../../services/apiError.js';
import { OVERPLACED_CODE, type OverplacedItem } from '@estimat/shared';

const item: OverplacedItem = {
  itemId: '11111111-1111-1111-1111-111111111111',
  name: 'Кирпич',
  placed: 10,
  frozenPlaced: 4,
  newQuantity: 6,
};

/** Ровно то, что теперь отправляет сервер. */
const realError = () =>
  new ApiError(409, 'По части материалов заказано больше нового объёма', {
    code: OVERPLACED_CODE,
    data: { overplaced: [item] },
  });

test('нагрузка сервера доходит до кода подтверждения', () => {
  const over = parseOverplaced(realError());
  assert.deepEqual(over, [item]);
});

test('список в КОРНЕ тела не принимается', () => {
  // Ровно прежний формат сервера: обёртка его не пробрасывает, и молча принять его нельзя —
  // иначе поломка вернётся незамеченной.
  const e = new ApiError(409, 'x', { code: OVERPLACED_CODE });
  (e as unknown as { overplaced: unknown }).overplaced = [item];
  assert.equal(parseOverplaced(e), null);
});

test('конфликт версии (OCC) не путается с перезаказом', () => {
  const occ = new ApiError(409, 'Заявка изменена, обновите страницу', { code: 'CONFLICT', data: { rowVersion: 7 } });
  assert.equal(parseOverplaced(occ), null);
});

test('чужие ошибки игнорируются', () => {
  assert.equal(parseOverplaced(new Error('сеть')), null);
  assert.equal(parseOverplaced(null), null);
  assert.equal(parseOverplaced(new ApiError(500, 'Ошибка сервера')), null);
});

test('битая нагрузка не роняет обработчик', () => {
  // safeParse, а не приведение типа: `as` одинаково молча принимал и правильную форму, и пустой
  // объект — из-за чего .map() падал бы уже в рендере модалки.
  for (const data of [{}, { overplaced: [] }, { overplaced: [{ itemId: 'нет-uuid' }] }, 'строка']) {
    assert.equal(parseOverplaced(new ApiError(409, 'x', { code: OVERPLACED_CODE, data })), null);
  }
});
