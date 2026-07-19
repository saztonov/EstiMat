// Тесты чистой логики группировки: детерминизм плана наборов (от него зависит resume),
// устойчивость парсера к мусору, глобальный merge и полнота итогового разбиения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatches, MAX_LINES_PER_BATCH } from './batch.js';
import { parseBatchResponse } from './parse.js';
import { assembleResult, applyMerges, type MergeOp } from './assemble.js';
import { buildBatchUserPrompt, buildSystemPrompt } from './prompt.js';
import { PROMPT_DEFAULTS } from '../llm/prompts.js';
import type { GroupingLine } from './types.js';

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

const mergeOp = (over: Partial<MergeOp> & { into: string; from: string[] }): MergeOp => ({
  name: null,
  purpose: null,
  completeness: null,
  compatibility: null,
  ...over,
});

// ---------- батчинг ----------

test('план наборов детерминирован: один вход — один и тот же план (нужно для resume)', () => {
  const lines = manyLines(200, 7);
  const a = planBatches(lines);
  const b = planBatches([...lines].reverse());
  const shape = (bs: ReturnType<typeof planBatches>) =>
    bs.map((x) => [x.index, x.affinityKey, x.lines.map((l) => l.orderKey).join(',')].join('#'));
  assert.deepEqual(shape(a), shape(b), 'порядок входа не должен влиять на план');
});

test('вид работ — affinity: набор не смешивает виды работ (родственное держим вместе)', () => {
  const lines = [...manyLines(90, 5, 'ct-heat'), ...manyLines(40, 5, 'ct-water')];
  for (const b of planBatches(lines)) {
    const kinds = new Set(b.lines.map((l) => l.costTypeId));
    assert.equal(kinds.size, 1, 'набор смешал виды работ');
  }
});

test('наборы не превышают лимит строк, работа не рвётся между наборами', () => {
  const lines = manyLines(300, 10);
  const batches = planBatches(lines);
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
  const batches = planBatches(lines);
  assert.ok(batches.length > 1);
  const keys = batches.flatMap((b) => b.lines.map((l) => l.orderKey));
  assert.equal(new Set(keys).size, 100, 'строки не должны потеряться или задвоиться при разрезании');
});

// ---------- промпт ----------

test('в промпт не попадают цены и поставщики; вид работ показан как контекст, место/тип — нет', () => {
  const lines = manyLines(3, 3);
  const text = buildBatchUserPrompt(planBatches(lines)[0]!);
  assert.ok(text.includes('вид работ: Отопление'), 'вид работ — контекст происхождения (affinity)');
  assert.ok(!text.includes('место:'), 'локация ушла из входа модели');
  assert.ok(!text.includes('тип:'), 'тип ушёл из входа модели');

  // Границы слов обязательны: «трубопровод» содержит «руб», и наивный поиск ловит сам себя.
  for (const t of [text, buildSystemPrompt(PROMPT_DEFAULTS['grouping.system'])]) {
    assert.ok(!/\bцен[аыу]\b|стоимост|поставщик|₽|\bруб\b/i.test(t), 'цены и поставщики модели не передаются');
  }
});

// ---------- парсер ----------

const batchOf = (lines: GroupingLine[]) => planBatches(lines)[0]!;

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

// ---------- глобальный merge ----------

test('merge сливает одну операцию через разные виды работ (границы вида работ больше нет)', () => {
  const lines = [...manyLines(3, 3, 'ct-heat'), ...manyLines(3, 3, 'ct-water')];
  const batches = planBatches(lines);
  const drafts = batches.map((b) => parseBatchResponse('{"groups":[{"name":"Монтаж трубопровода","idx":[1,2]}]}', b));
  const ids = drafts.flatMap((d) => d.groups.map((g) => g.id));
  assert.equal(ids.length, 2, 'две группы из двух видов работ');
  const { result } = assembleResult(lines, drafts, [mergeOp({ into: ids[0]!, from: [ids[1]!], name: 'Монтаж трубопровода' })], 2);
  assert.equal(result.groups.length, 1, 'одна операция под разными видами работ должна слиться');
});

test('переоценка модели перекрывает «худшее из двух» при слиянии', () => {
  const groups = [
    { id: 'g1', batchIndex: 0, name: 'A', purpose: null, completeness: 'incomplete' as const, compatibility: 'no_issues' as const, orderKeys: ['a'], issues: [], missing: [] },
    { id: 'g2', batchIndex: 0, name: 'B', purpose: null, completeness: 'incomplete' as const, compatibility: 'no_issues' as const, orderKeys: ['b'], issues: [], missing: [] },
  ];
  // Две неполные половины — модель вернула, что вместе они комплект.
  const revised = applyMerges(structuredClone(groups), [mergeOp({ into: 'g1', from: ['g2'], completeness: 'complete' })]);
  assert.equal(revised.groups.length, 1);
  assert.equal(revised.groups[0]!.completeness, 'complete', 'пересмотр модели важнее фолбэка worst-of');

  // Без пересмотра — консервативно худшее из двух.
  const fallback = applyMerges(structuredClone(groups), [mergeOp({ into: 'g1', from: ['g2'] })]);
  assert.equal(fallback.groups[0]!.completeness, 'incomplete');
});

// ---------- сборка итога ----------

test('итог — полное разбиение: группы + общие + не сгруппировано = все строки', () => {
  const lines = manyLines(5, 5);
  const batch = batchOf(lines);
  const draft = parseBatchResponse('{"groups":[{"name":"A","idx":[1,2]}],"shared":[3]}', batch);
  const { result } = assembleResult(lines, [draft], [], 1);

  assert.equal(result.stats.total, 5);
  assert.equal(result.stats.covered + result.stats.shared + result.stats.ungrouped, 5);
  assert.equal(result.stats.ungrouped, 2, 'забытые моделью строки должны осесть в «не сгруппировано»');

  const all = [...result.groups.flatMap((g) => g.orderKeys), ...result.sharedKeys, ...result.ungroupedKeys];
  assert.equal(new Set(all).size, 5, 'ни одна строка не потеряна и не задвоена');
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
