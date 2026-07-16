// Тесты чистой логики группировки: детерминизм плана наборов (от него зависит resume),
// устойчивость парсера к мусору и полнота итогового разбиения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatches, partitionKeyOf, partitionsNeedingMerge, MAX_LINES_PER_BATCH } from './batch.js';
import { parseBatchResponse } from './parse.js';
import { assembleResult } from './assemble.js';
import { buildBatchUserPrompt, buildSystemPrompt } from './prompt.js';
import { PROMPT_DEFAULTS } from '../llm/prompts.js';
import type { GroupingLine, GroupingSettings } from './types.js';

const ALL: GroupingSettings = { costType: true, location: true, locationType: true };
const NONE: GroupingSettings = { costType: false, location: false, locationType: false };

function line(over: Partial<GroupingLine> & { orderKey: string }): GroupingLine {
  return {
    costTypeId: 'ct-heat',
    costTypeName: 'Отопление',
    costCategoryId: 'cat',
    costCategoryName: 'Инженерные системы',
    materialId: null,
    name: 'Материал',
    unit: 'шт',
    quantity: 1,
    materialGroupName: 'Отопление',
    workNames: ['Работа'],
    primaryWorkId: 'w1',
    locationSig: 'k1:1',
    typeSig: 't1',
    locationLabels: ['Корпус 1'],
    typeLabels: ['РП-1'],
    ...over,
  };
}

/** N строк, разложенных по работам по `perWork` штук. */
function manyLines(n: number, perWork: number, costTypeId = 'ct-heat'): GroupingLine[] {
  return Array.from({ length: n }, (_, i) =>
    line({
      orderKey: `${costTypeId}|id:m${i}|шт`,
      name: `Материал ${String(i).padStart(3, '0')}`,
      costTypeId,
      primaryWorkId: `w${Math.floor(i / perWork)}`,
    }),
  );
}

// ---------- батчинг ----------

test('план наборов детерминирован: один вход — один и тот же план (нужно для resume)', () => {
  const lines = manyLines(200, 7);
  const a = planBatches(lines, ALL);
  const b = planBatches([...lines].reverse(), ALL);
  const shape = (bs: ReturnType<typeof planBatches>) =>
    bs.map((x) => [x.index, x.partitionKey, x.lines.map((l) => l.orderKey).join(',')].join('#'));
  assert.deepEqual(shape(a), shape(b), 'порядок входа не должен влиять на план');
});

test('при учёте вида работ в наборе не бывает двух видов работ', () => {
  const lines = [...manyLines(90, 5, 'ct-heat'), ...manyLines(40, 5, 'ct-water')];
  for (const b of planBatches(lines, ALL)) {
    const kinds = new Set(b.lines.map((l) => l.costTypeId));
    assert.equal(kinds.size, 1, 'набор смешал виды работ — модель смогла бы нарушить границу');
  }
});

test('без учёта вида работ разные виды работ могут попасть в один набор', () => {
  const lines = [...manyLines(10, 5, 'ct-heat'), ...manyLines(10, 5, 'ct-water')];
  const batches = planBatches(lines, NONE);
  assert.equal(batches.length, 1, 'мелкие виды работ должны паковаться вместе');
  assert.equal(new Set(batches[0]!.lines.map((l) => l.costTypeId)).size, 2);
});

test('наборы не превышают лимит строк, работа не рвётся между наборами', () => {
  const lines = manyLines(300, 10);
  const batches = planBatches(lines, ALL);
  const seenWorks = new Map<string, number>();
  for (const b of batches) {
    assert.ok(b.lines.length <= MAX_LINES_PER_BATCH, `набор ${b.index}: ${b.lines.length} строк`);
    for (const l of b.lines) {
      const prev = seenWorks.get(l.primaryWorkId);
      if (prev !== undefined) assert.equal(prev, b.index, `работа ${l.primaryWorkId} разорвана между наборами`);
      seenWorks.set(l.primaryWorkId, b.index);
    }
  }
});

test('работа крупнее лимита режется, и все её строки сохраняются', () => {
  const lines = manyLines(100, 100); // одна работа на 100 строк
  const batches = planBatches(lines, ALL);
  assert.ok(batches.length > 1);
  const keys = batches.flatMap((b) => b.lines.map((l) => l.orderKey));
  assert.equal(new Set(keys).size, 100, 'строки не должны потеряться или задвоиться при разрезании');
});

test('слияние требуется для областей, разъехавшихся по нескольким наборам', () => {
  const big = planBatches(manyLines(200, 10), ALL);
  assert.ok(partitionsNeedingMerge(big).length > 0, 'одна область в нескольких наборах — нужно слияние');
  const small = planBatches(manyLines(10, 5), ALL);
  assert.equal(partitionsNeedingMerge(small).length, 0, 'одна область в одном наборе — слияние не нужно');
});

test('ключ области учитывает только включённые параметры', () => {
  const l = line({ orderKey: 'k' });
  assert.equal(partitionKeyOf(l, NONE), '');
  assert.ok(partitionKeyOf(l, ALL).includes('ct:ct-heat'));
  assert.ok(!partitionKeyOf(l, { costType: true, location: false, locationType: false }).includes('loc:'));
});

// ---------- промпт ----------

test('в промпт не попадают цены и поставщики, а выключенные параметры не показываются', () => {
  const lines = manyLines(3, 3);
  const withAll = buildBatchUserPrompt(planBatches(lines, ALL)[0]!, ALL);
  assert.ok(withAll.includes('вид работ: Отопление'));
  assert.ok(withAll.includes('место: Корпус 1'));

  const withNone = buildBatchUserPrompt(planBatches(lines, NONE)[0]!, NONE);
  assert.ok(!withNone.includes('вид работ:'), 'выключенный параметр не должен попадать в промпт');
  assert.ok(!withNone.includes('место:'));
  assert.ok(!withNone.includes('тип:'));

  // Границы слов обязательны: «трубопровод» содержит «руб», и наивный поиск ловит сам себя.
  for (const text of [withAll, withNone, buildSystemPrompt(ALL, PROMPT_DEFAULTS['grouping.system'])]) {
    assert.ok(!/\bцен[аыу]\b|стоимост|поставщик|₽|\bруб\b/i.test(text), 'цены и поставщики модели не передаются');
  }
});

// ---------- парсер ----------

const batchOf = (lines: GroupingLine[]) => planBatches(lines, ALL)[0]!;

test('неизвестный номер позиции отбрасывается с предупреждением, ответ выживает', () => {
  const batch = batchOf(manyLines(3, 3));
  const res = parseBatchResponse('{"groups":[{"name":"Монтаж","idx":[1,99]}]}', batch);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0]!.orderKeys.length, 1);
  assert.ok(res.warnings.some((w) => w.includes('99')));
});

test('позиция, отнесённая к двум группам, уходит в «не сгруппировано», а не достаётся первой', () => {
  const batch = batchOf(manyLines(3, 3));
  const res = parseBatchResponse('{"groups":[{"name":"A","idx":[1,2]},{"name":"B","idx":[1,3]}]}', batch);
  const key1 = batch.lines[0]!.orderKey;
  assert.ok(!res.groups.some((g) => g.orderKeys.includes(key1)), 'спорная позиция не должна попасть в группу');
  assert.ok(res.ungroupedKeys.includes(key1));
});

test('битая группа выбрасывается, остальные сохраняются', () => {
  const batch = batchOf(manyLines(3, 3));
  const res = parseBatchResponse('{"groups":[{"idx":[1]},{"name":"Ок","idx":[2]}]}', batch);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0]!.name, 'Ок');
});

test('JSON в markdown-обёртке разбирается; недопустимый статус становится unknown', () => {
  const batch = batchOf(manyLines(2, 2));
  const res = parseBatchResponse(
    '```json\n{"groups":[{"name":"A","idx":[1],"completeness":"мусор","compatibility":"no_issues"}]}\n```',
    batch,
  );
  assert.equal(res.groups[0]!.completeness, 'unknown');
  assert.equal(res.groups[0]!.compatibility, 'no_issues');
});

test('неразобранный ответ не роняет батч', () => {
  const batch = batchOf(manyLines(2, 2));
  const res = parseBatchResponse('извините, не могу', batch);
  assert.equal(res.groups.length, 0);
  assert.ok(res.warnings.length > 0);
});

// ---------- сборка итога ----------

test('итог — полное разбиение: группы + общие + не сгруппировано = все строки', () => {
  const lines = manyLines(5, 5);
  const batch = batchOf(lines);
  // Модель упомянула не все строки: 1 и 2 в группе, 3 — общий, 4 и 5 забыты.
  const draft = parseBatchResponse('{"groups":[{"name":"A","idx":[1,2]}],"shared":[3]}', batch);
  const { result } = assembleResult(lines, [draft], [], 1);

  assert.equal(result.stats.total, 5);
  assert.equal(result.stats.covered + result.stats.shared + result.stats.ungrouped, 5);
  assert.equal(result.stats.ungrouped, 2, 'забытые моделью строки должны осесть в «не сгруппировано»');

  const all = [...result.groups.flatMap((g) => g.orderKeys), ...result.sharedKeys, ...result.ungroupedKeys];
  assert.equal(new Set(all).size, 5, 'ни одна строка не потеряна и не задвоена');
});

test('слияние групп из разных областей отклоняется', () => {
  const lines = [...manyLines(3, 3, 'ct-heat'), ...manyLines(3, 3, 'ct-water')];
  const batches = planBatches(lines, ALL);
  const drafts = batches.map((b) => parseBatchResponse('{"groups":[{"name":"Монтаж","idx":[1,2]}]}', b));
  const ids = drafts.flatMap((d) => d.groups.map((g) => g.id));
  const { result, warnings } = assembleResult(lines, drafts, [{ into: ids[0]!, from: [ids[1]!], name: null }], 2);

  assert.equal(result.groups.length, 2, 'группы разных видов работ не должны сливаться при включённой границе');
  assert.ok(warnings.some((w) => w.includes('отклонено')));
});

test('несуществующие ключи из ответа модели в итог не попадают', () => {
  const lines = manyLines(2, 2);
  const batch = batchOf(lines);
  const draft = parseBatchResponse('{"groups":[{"name":"A","idx":[1]}]}', batch);
  draft.groups[0]!.orderKeys.push('выдуманный|ключ');
  const { result } = assembleResult(lines, [draft], [], 1);
  assert.ok(!result.groups.flatMap((g) => g.orderKeys).includes('выдуманный|ключ'));
  assert.equal(result.stats.covered + result.stats.shared + result.stats.ungrouped, 2);
});
