// Проекция общего результата на область подрядчика.
//
// Проверяем главное: подрядчик не должен получить состав чужих работ. Результат считается по
// всей смете, а orderKey содержит название материала — без обрезки на сервере имена материалов
// всей сметы ушли бы в ответ API, и фильтрация на клиенте этого уже не исправит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupingResult } from '@estimat/shared';
import { projectResultFor } from './project.js';

const MINE_A = 'ct1|mine-a';
const MINE_B = 'ct1|mine-b';
const THEIRS = 'ct2|theirs';

function result(): GroupingResult {
  return {
    groups: [
      {
        id: 'g1',
        name: 'Моя операция',
        purpose: null,
        completeness: 'complete',
        compatibility: 'no_issues',
        orderKeys: [MINE_A, MINE_B],
        issues: [],
        missing: [{ name: 'Крепёж', reason: 'нужен для монтажа', need: 'required' }],
      },
      {
        id: 'g2',
        name: 'Чужая операция',
        purpose: null,
        completeness: 'complete',
        compatibility: 'no_issues',
        orderKeys: [THEIRS],
        issues: [],
        missing: [],
      },
      {
        id: 'g3',
        name: 'Смешанная операция',
        purpose: null,
        completeness: 'incomplete',
        compatibility: 'possible_issue',
        orderKeys: [MINE_A, THEIRS],
        issues: [
          { severity: 'warning', message: 'про мой материал', orderKeys: [MINE_A] },
          { severity: 'warning', message: 'про чужой материал', orderKeys: [THEIRS] },
          { severity: 'review', message: 'про группу целиком', orderKeys: [] },
        ],
        missing: [{ name: 'Гильза', reason: 'проход через стену', need: 'required' }],
      },
    ],
    sharedKeys: [MINE_B, THEIRS],
    ungroupedKeys: [THEIRS],
    // covered = 2 (g1) + 1 (g2) + 2 (g3); total = covered + shared + ungrouped.
    stats: { batches: 2, groups: 3, covered: 5, shared: 2, ungrouped: 1, total: 8 },
  };
}

const visible = new Set([MINE_A, MINE_B]);

test('группа целиком из чужих строк исчезает', () => {
  const p = projectResultFor(result(), visible);
  assert.deepEqual(
    p.groups.map((g) => g.id),
    ['g1', 'g3'],
    'g2 состоит только из чужих материалов',
  );
});

test('чужие ключи вырезаны отовсюду', () => {
  const p = projectResultFor(result(), visible);
  const keys = [...p.groups.flatMap((g) => g.orderKeys), ...p.sharedKeys, ...p.ungroupedKeys];
  assert.ok(!keys.includes(THEIRS), 'ключ содержит название материала — утечка состава сметы');
  assert.deepEqual(p.sharedKeys, [MINE_B]);
  assert.deepEqual(p.ungroupedKeys, []);
});

test('замечание про чужую строку не показывается, про группу целиком — остаётся', () => {
  const p = projectResultFor(result(), visible);
  const mixed = p.groups.find((g) => g.id === 'g3')!;
  assert.deepEqual(
    mixed.issues.map((i) => i.message),
    ['про мой материал', 'про группу целиком'],
  );
  assert.deepEqual(mixed.issues[0]!.orderKeys, [MINE_A]);
});

test('«не хватает» скрыто у частично видимой группы и сохранено у полностью видимой', () => {
  const p = projectResultFor(result(), visible);
  // g3 видна не целиком: недостающее может заказывать другой подрядчик — совет вводил бы в
  // заблуждение.
  assert.deepEqual(p.groups.find((g) => g.id === 'g3')!.missing, []);
  assert.equal(p.groups.find((g) => g.id === 'g1')!.missing.length, 1);
});

test('статистика пересчитана по видимому: covered + shared + ungrouped = total', () => {
  const p = projectResultFor(result(), visible);
  assert.deepEqual(p.stats, { batches: 2, groups: 2, covered: 3, shared: 1, ungrouped: 0, total: 4 });
});

test('полная видимость не меняет результат', () => {
  const src = result();
  const p = projectResultFor(src, new Set([MINE_A, MINE_B, THEIRS]));
  assert.deepEqual(p, src);
});
