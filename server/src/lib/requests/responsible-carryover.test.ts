import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryOverKey, matchResponsibleCarryOver, type ResponsibleSnapshot } from './responsible-carryover.js';

// Снимок ОДНОЙ строки с её набором ответственных.
const snap = (costTypeId: string, aggKey: string, deliveryDate: string | null, userIds: string[]): ResponsibleSnapshot =>
  ({ costTypeId, aggKey, deliveryDate, responsibles: userIds.map((userId) => ({ userId, assignedBy: 'admin', assignedAt: '2026-07-19T00:00:00Z' })) });

const userIdsOf = (s: ResponsibleSnapshot) => s.responsibles.map((r) => r.userId);

test('carryOverKey: null-дата и заданная дата дают разные ключи', () => {
  assert.notEqual(carryOverKey({ costTypeId: 'ct', aggKey: 'a', deliveryDate: null }),
                  carryOverKey({ costTypeId: 'ct', aggKey: 'a', deliveryDate: '2026-07-20' }));
});

test('перенос: совпавшие по ключу переносятся, изменённые/исчезнувшие — нет', () => {
  const snapshot = [
    snap('ct1', 'a', null, ['u1']),        // ключ сохранится
    snap('ct1', 'b', '2026-07-20', ['u2']), // дата изменится → не перенесётся
    snap('ct2', 'c', null, ['u3']),        // позиция исчезнет → не перенесётся
  ];
  const newKeys = [
    { costTypeId: 'ct1', aggKey: 'a', deliveryDate: null },        // совпадает
    { costTypeId: 'ct1', aggKey: 'b', deliveryDate: '2026-07-25' }, // др. дата
    { costTypeId: 'ct9', aggKey: 'z', deliveryDate: null },        // новая позиция
  ];
  const kept = matchResponsibleCarryOver(snapshot, newKeys);
  assert.deepEqual(kept.map(userIdsOf), [['u1']]);
});

test('перенос: несколько ответственных одной строки переносятся все', () => {
  const kept = matchResponsibleCarryOver(
    [snap('ct1', 'a', null, ['u1', 'u2'])],
    [{ costTypeId: 'ct1', aggKey: 'a', deliveryDate: null }],
  );
  assert.deepEqual(kept.map(userIdsOf), [['u1', 'u2']]);
});

test('перенос: пустой снимок — ничего не переносится', () => {
  assert.deepEqual(matchResponsibleCarryOver([], [{ costTypeId: 'ct', aggKey: 'a', deliveryDate: null }]), []);
});

test('перенос: неуникальный ключ среди новых строк не переносится (нет over-apply)', () => {
  // Одна исходная строка, но в новых ключ встречается дважды → пропускаем (иначе назначили бы обеим).
  const kept = matchResponsibleCarryOver(
    [snap('ct1', 'a', null, ['u1'])],
    [
      { costTypeId: 'ct1', aggKey: 'a', deliveryDate: null },
      { costTypeId: 'ct1', aggKey: 'a', deliveryDate: null },
    ],
  );
  assert.deepEqual(kept, []);
});

test('перенос: две исходные строки одного ключа не переносятся (конфликт)', () => {
  const kept = matchResponsibleCarryOver(
    [snap('ct1', 'a', null, ['u1']), snap('ct1', 'a', null, ['u2'])],
    [{ costTypeId: 'ct1', aggKey: 'a', deliveryDate: null }],
  );
  assert.deepEqual(kept, []);
});
