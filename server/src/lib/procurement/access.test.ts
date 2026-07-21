/**
 * Матрица доступа к заказу поставщику. Ходящие в БД обёртки только подают сюда данные — всё
 * решение принимает decideOrderAccess, поэтому тестируется оно целиком.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOrderAccess } from './access.js';

const ME = 'user-me';
const OTHER = 'user-other';
const free = { assignedUserId: null, effectiveUserId: null };
const mine = { assignedUserId: ME, effectiveUserId: ME };
const foreign = { assignedUserId: OTHER, effectiveUserId: OTHER };

const base = { role: 'engineer' as const, userId: ME, hasScopeWithoutCostType: false };

test('admin и manager ведут любой заказ', () => {
  for (const role of ['admin', 'manager'] as const) {
    assert.equal(
      decideOrderAccess({ ...base, role, verdicts: [foreign], createdBy: OTHER }).ok,
      true,
      `${role} должен проходить`,
    );
    // …в том числе чужой пустой заказ и позиции без вида затрат.
    assert.equal(decideOrderAccess({ ...base, role, verdicts: [], createdBy: OTHER, isEmptyOrder: true }).ok, true);
    assert.equal(decideOrderAccess({ ...base, role, verdicts: [], hasScopeWithoutCostType: true }).ok, true);
  }
});

test('инженер: своя зона — да, чужая — нет', () => {
  assert.equal(decideOrderAccess({ ...base, verdicts: [mine] }).ok, true);
  assert.equal(decideOrderAccess({ ...base, verdicts: [foreign] }).ok, false);
});

test('одна чужая область среди своих закрывает весь заказ', () => {
  // Заказ — единица работы: частичного доступа не бывает, иначе половину состава можно было бы
  // изменить, а согласование ушло бы целиком.
  assert.equal(decideOrderAccess({ ...base, verdicts: [mine, free, foreign] }).ok, false);
});

test('область без назначений доступна всем внутренним ролям', () => {
  assert.equal(decideOrderAccess({ ...base, verdicts: [free, free] }).ok, true);
});

test('заместитель работает наравне с ответственным', () => {
  // Доступ ОБЪЕДИНЯЕТСЯ, а не передаётся: на время замещения ответственный тоже остаётся.
  const substituted = { assignedUserId: OTHER, effectiveUserId: ME };
  assert.equal(decideOrderAccess({ ...base, verdicts: [substituted] }).ok, true);
  assert.equal(decideOrderAccess({ ...base, userId: OTHER, verdicts: [substituted] }).ok, true);
});

test('позиция без вида затрат — только админ', () => {
  const r = decideOrderAccess({ ...base, verdicts: [free], hasScopeWithoutCostType: true });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : '', /вида затрат/);
});

test('пустой заказ доступен создателю и закрыт для остальных', () => {
  // Без этого правила чужой черновик оставался бы открыт всем: пустой список областей проходит
  // цикл проверки насквозь и раньше означал «доступ разрешён».
  assert.equal(decideOrderAccess({ ...base, verdicts: [], createdBy: ME, isEmptyOrder: true }).ok, true);
  assert.equal(decideOrderAccess({ ...base, verdicts: [], createdBy: OTHER, isEmptyOrder: true }).ok, false);
  assert.equal(decideOrderAccess({ ...base, verdicts: [], createdBy: null, isEmptyOrder: true }).ok, false);
});

test('«нечего заказывать» — это не пустой заказ', () => {
  // Путь создания: областей ноль, потому что нечего добавлять; правило пустого ЗАКАЗА тут
  // неприменимо и создателя проверять не по чему.
  assert.equal(decideOrderAccess({ ...base, verdicts: [] }).ok, true);
});
