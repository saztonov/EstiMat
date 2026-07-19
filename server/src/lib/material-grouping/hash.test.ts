// Хэш входа решает, актуален ли готовый результат. Слишком чувствительный — выбрасывает
// 20-минутный прогон на ровном месте; слишком грубый — молча показывает устаревшие группы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffectivePromptVersion, computeInputHash, computeScopeHash } from './input.js';
import type { GroupingLine } from './types.js';

const MODEL = 'openrouter:gemini';
const VERSION = 'mg-3';

function line(over: Partial<GroupingLine> & { orderKey: string }): GroupingLine {
  return {
    costTypeId: 'ct',
    costTypeName: 'Отопление',
    costCategoryId: 'cat',
    costCategoryName: 'Инженерные',
    materialId: null,
    name: 'Труба',
    unit: 'м',
    quantity: 10,
    materialGroupName: null,
    workNames: ['Работа'],
    primaryWorkId: 'w1',
    ...over,
  };
}

const base = () => [line({ orderKey: 'a' }), line({ orderKey: 'b', name: 'Кран' })];
const hash = (lines: GroupingLine[], model = MODEL, v = VERSION) => computeInputHash(lines, model, v);

test('хэш не зависит от порядка строк во входе', () => {
  const lines = base();
  assert.equal(hash(lines), hash([...lines].reverse()));
});

test('хэш меняется при изменении состава, количеств, контекста, модели и версии промпта', () => {
  const h0 = hash(base());

  const added = [...base(), line({ orderKey: 'c', name: 'Отвод' })];
  assert.notEqual(hash(added), h0, 'добавленный материал');

  const requantified = base();
  requantified[0]!.quantity = 11;
  assert.notEqual(hash(requantified), h0, 'изменённое количество (доля подрядчика) — модель проверяет соотношения');

  const regrouped = base();
  regrouped[0]!.materialGroupName = 'Другой раздел';
  assert.notEqual(hash(regrouped), h0, 'группа справочника входит в промпт');

  const reworked = base();
  reworked[0]!.workNames = ['Переименованная работа'];
  assert.notEqual(hash(reworked), h0, 'имена работ входят в промпт (slice 0..3)');

  assert.notEqual(hash(base(), 'lmstudio:qwen'), h0, 'смена модели');
  assert.notEqual(hash(base(), MODEL, 'mg-4'), h0, 'новая версия промпта');
});

test('незначимый хвост числа не объявляет результат устаревшим', () => {
  const jittered = base();
  jittered[0]!.quantity = 10 + 1e-9;
  assert.equal(hash(jittered), hash(base()), 'округление до 4 знаков — как в колонке «По смете»');
});

test('порядок имён работ на хэш не влияет (сортируются на входе)', () => {
  const a = base();
  a[0]!.workNames = ['Альфа', 'Бета'];
  const b = base();
  b[0]!.workNames = ['Бета', 'Альфа'];
  assert.equal(hash(a), hash(b), 'workNames приходят отсортированными из loadGroupingLines');
});

test('эффективная версия промпта меняется от текста system, merge и режима noThink', () => {
  const v0 = computeEffectivePromptVersion('mg-3', 'system', 'merge', false);
  assert.equal(v0, computeEffectivePromptVersion('mg-3', 'system', 'merge', false), 'детерминизм');
  assert.notEqual(v0, computeEffectivePromptVersion('mg-3', 'SYSTEM', 'merge', false), 'правка system');
  assert.notEqual(v0, computeEffectivePromptVersion('mg-3', 'system', 'MERGE', false), 'правка merge');
  assert.notEqual(v0, computeEffectivePromptVersion('mg-3', 'system', 'merge', true), 'смена noThink');
  assert.ok(v0.startsWith('mg-3:'), 'читаемая базовая версия сохраняется в префиксе');
});

test('правка текста промпта инвалидирует input_hash через эффективную версию', () => {
  const v1 = computeEffectivePromptVersion('mg-3', 'system-A', 'merge', false);
  const v2 = computeEffectivePromptVersion('mg-3', 'system-B', 'merge', false);
  assert.notEqual(hash(base(), MODEL, v1), hash(base(), MODEL, v2));
});

test('хэш области зависит от сметы И подрядчика: у каждого подрядчика свой расчёт', () => {
  const e1c1 = computeScopeHash({ estimateId: 'e1', contractorId: 'c1' });
  assert.equal(e1c1, computeScopeHash({ estimateId: 'e1', contractorId: 'c1' }), 'детерминизм');
  assert.notEqual(e1c1, computeScopeHash({ estimateId: 'e1', contractorId: 'c2' }), 'разные подрядчики — разный scope');
  assert.notEqual(e1c1, computeScopeHash({ estimateId: 'e2', contractorId: 'c1' }), 'разные сметы — разный scope');
});
