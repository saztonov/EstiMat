// Хэш входа решает, актуален ли готовый результат. Слишком чувствительный — выбрасывает
// 20-минутный прогон на ровном месте; слишком грубый — молча показывает устаревшие группы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInputHash, computeScopeHash } from './input.js';
import type { GroupingLine, GroupingSettings } from './types.js';

const SETTINGS: GroupingSettings = { costType: true, location: false, locationType: false };
const MODEL = 'openrouter:gemini';
const VERSION = 'mg-1';

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
    locationSig: 'k1',
    typeSig: 't1',
    locationLabels: [],
    typeLabels: [],
    ...over,
  };
}

const base = () => [line({ orderKey: 'a' }), line({ orderKey: 'b', name: 'Кран' })];
const hash = (lines: GroupingLine[], s = SETTINGS, model = MODEL, v = VERSION) =>
  computeInputHash(lines, s, model, v);

test('хэш не зависит от порядка строк во входе', () => {
  const lines = base();
  assert.equal(hash(lines), hash([...lines].reverse()));
});

test('хэш меняется при изменении состава, количеств, настроек, модели и версии промпта', () => {
  const h0 = hash(base());

  const added = [...base(), line({ orderKey: 'c', name: 'Отвод' })];
  assert.notEqual(hash(added), h0, 'добавленный материал');

  const requantified = base();
  requantified[0]!.quantity = 11;
  assert.notEqual(hash(requantified), h0, 'изменённое количество — модель проверяет соотношения');

  assert.notEqual(hash(base(), { costType: true, location: true, locationType: false }), h0, 'настройки');
  assert.notEqual(hash(base(), SETTINGS, 'lmstudio:qwen'), h0, 'смена модели');
  assert.notEqual(hash(base(), SETTINGS, MODEL, 'mg-2'), h0, 'новая версия промпта');
});

test('незначимый хвост числа не объявляет результат устаревшим', () => {
  const jittered = base();
  jittered[0]!.quantity = 10 + 1e-9;
  assert.equal(hash(jittered), hash(base()), 'округление до 4 знаков — как в колонке «По смете»');
});

test('хэш области различает подрядчика, сотрудника и отбор по подрядчикам', () => {
  const est = 'e1';
  const staff = computeScopeHash({ estimateId: est, orgId: null, contractorIds: [] });
  const contractor = computeScopeHash({ estimateId: est, orgId: 'org1', contractorIds: [] });
  const filtered = computeScopeHash({ estimateId: est, orgId: null, contractorIds: ['org1'] });

  assert.notEqual(staff, contractor, 'у подрядчика свои цифры — кэш делить нельзя');
  assert.notEqual(staff, filtered);
  assert.notEqual(contractor, filtered);

  // Порядок отбора не важен.
  assert.equal(
    computeScopeHash({ estimateId: est, orgId: null, contractorIds: ['a', 'b'] }),
    computeScopeHash({ estimateId: est, orgId: null, contractorIds: ['b', 'a'] }),
  );
});
