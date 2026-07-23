// Тесты чистой логики группировки: детерминизм плана наборов (от него зависит resume),
// устойчивость парсера к мусору, глобальный merge и полнота итогового разбиения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatches, MAX_LINES_PER_BATCH } from './batch.js';
import { parseBatchResponse, parseMergeResponse } from './parse.js';
import { assembleResult, applyMerges, type MergeOp } from './assemble.js';
import { buildBatchUserPrompt, buildMergeUserPrompt, buildSystemPrompt } from './prompt.js';
import { computeInputHash } from './input.js';
import { PROMPT_DEFAULTS } from '../llm/prompts.js';
import type { DraftGroup, GroupingLine } from './types.js';

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
  stage: null,
  completeness: null,
  compatibility: null,
  ...over,
});

const draft = (over: Partial<DraftGroup> & { id: string }): DraftGroup => ({
  batchIndex: 0,
  name: over.id.toUpperCase(),
  purpose: null,
  stage: null,
  completeness: 'unknown',
  compatibility: 'no_issues',
  orderKeys: [over.id],
  issues: [],
  missing: [],
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

test('merge сливает один комплект через разные виды работ (границы вида работ больше нет)', () => {
  const lines = [...manyLines(3, 3, 'ct-heat'), ...manyLines(3, 3, 'ct-water')];
  const batches = planBatches(lines);
  const drafts = batches.map((b) => parseBatchResponse('{"groups":[{"name":"Монтаж трубопровода","idx":[1,2]}]}', b));
  const ids = drafts.flatMap((d) => d.groups.map((g) => g.id));
  assert.equal(ids.length, 2, 'две группы из двух видов работ');
  const { result } = assembleResult(lines, drafts, [mergeOp({ into: ids[0]!, from: [ids[1]!], name: 'Монтаж трубопровода' })], 2);
  assert.equal(result.groups.length, 1, 'один комплект под разными видами работ должен слиться');
});

test('переоценка модели перекрывает «худшее из двух» при слиянии', () => {
  const groups = [
    draft({ id: 'g1', completeness: 'incomplete', orderKeys: ['a'] }),
    draft({ id: 'g2', completeness: 'incomplete', orderKeys: ['b'] }),
  ];
  // Две неполные половины — модель вернула, что вместе они комплект.
  const revised = applyMerges(structuredClone(groups), [mergeOp({ into: 'g1', from: ['g2'], completeness: 'complete' })]);
  assert.equal(revised.groups.length, 1);
  assert.equal(revised.groups[0]!.completeness, 'complete', 'пересмотр модели важнее фолбэка worst-of');

  // Без пересмотра — консервативно худшее из двух.
  const fallback = applyMerges(structuredClone(groups), [mergeOp({ into: 'g1', from: ['g2'] })]);
  assert.equal(fallback.groups[0]!.completeness, 'incomplete');
});

// ---------- стадия готовности ----------

test('стадия берётся только из закрытого списка: мусор и отсутствие дают null', () => {
  const batch = batchOf(manyLines(3, 3));
  const res = parseBatchResponse(
    '{"groups":[{"name":"A","idx":[1],"stage":"finish"},{"name":"B","idx":[2],"stage":"чистовая"},{"name":"C","idx":[3]}]}',
    batch,
  );
  assert.deepEqual(
    res.groups.map((g) => g.stage),
    ['finish', null, null],
  );
});

test('стадия из ответа слияния тоже проходит allowlist', () => {
  const known = new Set(['g1', 'g2']);
  const ok = parseMergeResponse('{"merge":[{"into":"g1","from":["g2"],"stage":"main"}]}', known);
  assert.equal(ok[0]!.stage, 'main');
  const bad = parseMergeResponse('{"merge":[{"into":"g1","from":["g2"],"stage":"монтаж"}]}', known);
  assert.equal(bad[0]!.stage, null, 'выдуманная стадия не должна стать границей слияния');
});

test('разные известные стадии не сливаются, даже если модель просит', () => {
  const groups = [
    draft({ id: 'g1', name: 'Черновая разводка', stage: 'main' }),
    draft({ id: 'g2', name: 'Установка приборов', stage: 'finish' }),
  ];
  const res = applyMerges(structuredClone(groups), [mergeOp({ into: 'g1', from: ['g2'] })]);
  assert.equal(res.groups.length, 2, 'скрытые работы и финишный монтаж закупаются к разным порогам готовности');
  assert.ok(res.warnings.some((w) => w.includes('стадиям')), 'отклонённое слияние должно быть видно в предупреждениях');
});

test('неизвестная стадия слиянию не мешает: null и other границей не считаются', () => {
  const withNull = applyMerges(
    [draft({ id: 'g1', stage: 'main' }), draft({ id: 'g2', stage: null })],
    [mergeOp({ into: 'g1', from: ['g2'] })],
  );
  assert.equal(withNull.groups.length, 1);
  const withOther = applyMerges(
    [draft({ id: 'g1', stage: 'main' }), draft({ id: 'g2', stage: 'other' })],
    [mergeOp({ into: 'g1', from: ['g2'] })],
  );
  assert.equal(withOther.groups.length, 1);
});

test('совпадение стадии само по себе ничего не сливает', () => {
  const groups = [draft({ id: 'g1', stage: 'main' }), draft({ id: 'g2', stage: 'main' })];
  assert.equal(applyMerges(structuredClone(groups), []).groups.length, 2, 'слияние — решение модели, а не следствие ярлыка');
});

test('пересмотренная моделью стадия применяется к объединённой группе', () => {
  const res = applyMerges(
    [draft({ id: 'g1', stage: 'main' }), draft({ id: 'g2', stage: null })],
    [mergeOp({ into: 'g1', from: ['g2'], stage: 'finish' })],
  );
  assert.equal(res.groups[0]!.stage, 'finish', 'следующий раунд должен видеть актуальный ярлык');
});

test('стадия — служебная: в итоговый результат она не выходит', () => {
  const lines = manyLines(2, 2);
  const batch = batchOf(lines);
  const parsed = parseBatchResponse('{"groups":[{"name":"A","idx":[1,2],"stage":"main"}]}', batch);
  const { result } = assembleResult(lines, [parsed], [], 1);
  assert.ok(!('stage' in result.groups[0]!), 'публичный контракт группы не меняется');
});

// ---------- согласованность замечаний после слияния ----------

test('обязательные «не хватает» снимаются, когда модель объявила комплект полным', () => {
  const groups = [
    draft({
      id: 'g1',
      completeness: 'incomplete',
      missing: [
        { name: 'Смеситель', reason: 'нет в составе', need: 'required' },
        { name: 'Уплотнитель', reason: 'проверить', need: 'recommended' },
      ],
    }),
    draft({ id: 'g2', completeness: 'incomplete' }),
  ];
  const res = applyMerges(structuredClone(groups), [mergeOp({ into: 'g1', from: ['g2'], completeness: 'complete' })]);
  assert.deepEqual(
    res.groups[0]!.missing.map((m) => m.name),
    ['Уплотнитель'],
    'закрытое второй половиной требование не должно висеть на комплекте, рекомендация — остаётся',
  );
});

test('одинаковые замечания половин схлопываются', () => {
  const issue = { severity: 'review' as const, message: 'уточните кратность поставки', orderKeys: [] };
  const miss = { name: 'Кронштейн', reason: 'проверить', need: 'conditional' as const };
  const res = applyMerges(
    [draft({ id: 'g1', issues: [issue], missing: [miss] }), draft({ id: 'g2', issues: [{ ...issue }], missing: [{ ...miss }] })],
    [mergeOp({ into: 'g1', from: ['g2'] })],
  );
  assert.equal(res.groups[0]!.issues.length, 1);
  assert.equal(res.groups[0]!.missing.length, 1);
});

// ---------- карточки слияния ----------

test('карточки слияния несут стадию и контекст и идут в стабильном порядке', () => {
  const lines = [...manyLines(2, 2, 'ct-water'), ...manyLines(2, 2, 'ct-heat')];
  const byKey = new Map(lines.map((l) => [l.orderKey, { ...l, costTypeName: l.costTypeId === 'ct-heat' ? 'Отопление' : 'Водоснабжение' }]));
  const groups = [
    draft({ id: 'g1', name: 'Стояки водоснабжения', stage: 'main', orderKeys: [lines[0]!.orderKey] }),
    draft({ id: 'g2', name: 'Приборы отопления', stage: 'finish', orderKeys: [lines[2]!.orderKey] }),
  ];
  const text = buildMergeUserPrompt(groups, byKey);
  assert.ok(text.includes('этап: main') && text.includes('этап: finish'));
  assert.ok(text.includes('виды работ: Водоснабжение'));
  assert.ok(text.includes('категории: Инженерные системы'));
  // Порядок не зависит от порядка групп на входе.
  assert.equal(text, buildMergeUserPrompt([...groups].reverse(), byKey));
});

// ---------- актуальность результата ----------

test('переименование категории или вида работ объявляет результат устаревшим', () => {
  const lines = manyLines(2, 2);
  const base = computeInputHash(lines, 'openrouter:model', 'mg-4');
  const renamedType = computeInputHash(
    lines.map((l) => ({ ...l, costTypeName: 'Отопление и вентиляция' })),
    'openrouter:model',
    'mg-4',
  );
  const renamedCategory = computeInputHash(
    lines.map((l) => ({ ...l, costCategoryName: 'ВИС' })),
    'openrouter:model',
    'mg-4',
  );
  assert.notEqual(base, renamedType, 'вид работ виден модели — его переименование меняет вход');
  assert.notEqual(base, renamedCategory, 'категория видна модели — её переименование меняет вход');
  assert.notEqual(base, computeInputHash(lines, 'openrouter:model', 'mg-3'), 'версия промпта входит в хэш');
});

test('пересоздание строки сметы не объявляет результат устаревшим', () => {
  const lines = manyLines(2, 2);
  assert.equal(
    computeInputHash(lines, 'openrouter:model', 'mg-4'),
    computeInputHash(lines.map((l) => ({ ...l, primaryWorkId: 'w-new' })), 'openrouter:model', 'mg-4'),
    'идентификатор строки-источника смысла для модели не несёт — пересчёт на 10–25 минут был бы впустую',
  );
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
