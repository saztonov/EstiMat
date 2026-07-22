// Тесты блоков окна графика поставки и отбора «Не заказанные материалы».
//
// Проверяют то, чего на экране не видно: что ни один материал не потерялся между блоками и что
// повторяющийся ключ не задвоил количество к поставке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupingResult, MaterialGroupDto } from '@estimat/shared';
import { aggKey, lineKey } from '@estimat/shared';
import type { LocationSnapshot } from '../../estimates/components/location';
import type { AggregatedMaterial, MaterialGroup, MaterialOccurrence } from '../../estimates/materials/aggregateMaterials';
import { buildOrderRows, type CategoryIndex, type OrderMaterialRow } from './orderRow';
import { buildMaterialTree, pruneNodesByRows, type MaterialLevelSettings } from './materialTree';
import { REST_KEY, SHARED_KEY, UNGROUPED_KEY, smartBlocks, standardBlocks } from './materialBlocks';
import { countReviewGroups, groupCheck, isReviewGroup } from './smartReview';
import type { DimensionFinding } from './dimensionChecks';

// ---------- фикстуры ----------

const zoneIndex = new Map([['zone-k1', 'Корпус 1']]);
const LEVELS: MaterialLevelSettings = { costType: true, location: false, locationType: false };

const snap = (): LocationSnapshot => ({
  locations: [{ zoneId: 'zone-k1', floors: [1] }],
  zoneId: 'zone-k1',
  zoneName: 'Корпус 1',
  floorFrom: null,
  floorTo: null,
  locationTypeId: null,
  locationTypeName: null,
});

let seq = 0;
function occ(quantity: number): MaterialOccurrence {
  seq++;
  return {
    materialRowId: `mr${seq}`,
    workId: `w${seq}`,
    workName: `Работа ${seq}`,
    quantity,
    unit: 'шт',
    unitPrice: 10,
    total: quantity * 10,
    needsReview: false,
    status: 'confirmed',
    location: snap(),
  };
}

function agg(materialId: string, name: string, quantity: number): AggregatedMaterial {
  return {
    key: aggKey(materialId, name, 'шт'),
    materialId,
    name,
    unit: 'шт',
    quantity,
    total: quantity * 10,
    unitPrice: 10,
    hasAi: false,
    hasNeedsReview: false,
    hasSuggested: false,
    occurrences: [occ(quantity)],
  };
}

function group(costTypeId: string, costTypeName: string, materials: AggregatedMaterial[]): MaterialGroup {
  return {
    costTypeId,
    costTypeName,
    costCategoryName: 'Инженерные системы',
    contractorName: null,
    materials,
    total: materials.reduce((s, m) => s + m.total, 0),
  };
}

const categoryIndex: CategoryIndex = new Map([
  ['ct-heat', { id: 'cat-eng', name: 'Инженерные системы' }],
  ['ct-water', { id: 'cat-eng', name: 'Инженерные системы' }],
]);

/** Смета: две работы, три материала. */
function rowsOf(): OrderMaterialRow[] {
  seq = 0;
  return buildOrderRows(
    [
      group('ct-heat', 'Отопление', [agg('m-pipe', 'Труба Ду25', 10), agg('m-valve', 'Кран шаровый', 4)]),
      group('ct-water', 'Водоснабжение', [agg('m-tee', 'Тройник', 6)]),
    ],
    categoryIndex,
    zoneIndex,
  );
}

const keyOf = (rows: OrderMaterialRow[], name: string) => rows.find((r) => r.name === name)!.orderKey;
const allKeys = (blocks: { orderKeys: string[] }[]) => blocks.flatMap((b) => b.orderKeys);

function dto(over: Partial<MaterialGroupDto> = {}): MaterialGroupDto {
  return {
    id: 'g1',
    name: 'Монтаж трубопровода',
    purpose: null,
    completeness: 'complete',
    compatibility: 'no_issues',
    orderKeys: [],
    issues: [],
    missing: [],
    ...over,
  };
}

const result = (over: Partial<GroupingResult> = {}): GroupingResult => ({
  groups: [],
  sharedKeys: [],
  ungroupedKeys: [],
  stats: { batches: 1, groups: 0, covered: 0, shared: 0, ungrouped: 0, total: 0 },
  ...over,
});

// ---------- стандартные блоки ----------

test('standardBlocks: лист дерева = блок, свод сохраняется', () => {
  const rows = rowsOf();
  const blocks = standardBlocks(rows, LEVELS);
  const keys = allKeys(blocks);

  assert.equal(keys.length, rows.length, 'строк в блоках столько же, сколько во входе');
  assert.equal(new Set(keys).size, keys.length, 'ключи не задвоены');
  assert.equal(blocks.length, 2, 'два вида работ — два блока');
  assert.ok(
    blocks.every((b) => b.title.includes('Инженерные системы')),
    'подпись — путь до листа, а не голое имя узла',
  );
  assert.ok(!blocks.some((b) => b.key === REST_KEY), 'дерево покрывает всё — хвостового блока нет');
});

// ---------- умные блоки ----------

test('smartBlocks: группы, секции и порядок', () => {
  const rows = rowsOf();
  const pipe = keyOf(rows, 'Труба Ду25');
  const valve = keyOf(rows, 'Кран шаровый');
  const tee = keyOf(rows, 'Тройник');

  const blocks = smartBlocks(
    rows,
    result({ groups: [dto({ orderKeys: [pipe, valve] })], sharedKeys: [tee], ungroupedKeys: [] }),
  );

  assert.deepEqual(
    blocks.map((b) => b.key),
    ['g1', SHARED_KEY],
  );
  assert.equal(allKeys(blocks).length, rows.length, 'ничего не потеряно');
});

test('smartBlocks: пересечение групп не задваивает материал', () => {
  const rows = rowsOf();
  const pipe = keyOf(rows, 'Труба Ду25');

  const blocks = smartBlocks(
    rows,
    result({
      groups: [dto({ id: 'g1', orderKeys: [pipe] }), dto({ id: 'g2', orderKeys: [pipe] })],
      sharedKeys: [pipe],
    }),
  );
  const keys = allKeys(blocks);

  assert.equal(keys.filter((k) => k === pipe).length, 1, 'ключ забирает первый заявивший блок');
  assert.equal(new Set(keys).size, keys.length);
});

test('smartBlocks: устаревший результат — материалы уходят в хвостовой блок', () => {
  const rows = rowsOf();
  const pipe = keyOf(rows, 'Труба Ду25');

  const blocks = smartBlocks(rows, result({ groups: [dto({ orderKeys: [pipe] })] }));
  const rest = blocks.find((b) => b.key === REST_KEY);

  assert.ok(rest, 'строки вне группировки не исчезают');
  assert.equal(rest!.orderKeys.length, 2);
  assert.equal(allKeys(blocks).length, rows.length);
});

test('smartBlocks: чужие ключи в результате игнорируются', () => {
  const rows = rowsOf();
  const blocks = smartBlocks(
    rows,
    result({ groups: [dto({ orderKeys: [lineKey('ct-alien', 'agg-alien')] })], ungroupedKeys: rows.map((r) => r.orderKey) }),
  );

  assert.deepEqual(
    blocks.map((b) => b.key),
    [UNGROUPED_KEY],
    'группа целиком из чужих строк не показывается',
  );
  assert.equal(allKeys(blocks).length, rows.length);
});

test('smartBlocks: без результата — один блок со всеми материалами', () => {
  const rows = rowsOf();
  const blocks = smartBlocks(rows, null);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.orderKeys.length, rows.length, 'заявку набирают и без умной группировки');
  assert.deepEqual(smartBlocks([], null), [], 'пустой вход — пустой список, а не блок-пустышка');
});

// ---------- отбор «Не заказанные материалы» ----------

test('pruneNodesByRows: узел без остатка уходит целиком, строки внутри не прячутся', () => {
  const rows = rowsOf();
  const tree = buildMaterialTree(rows, LEVELS);
  const pipe = keyOf(rows, 'Труба Ду25');

  const pruned = pruneNodesByRows(tree, new Set([pipe]));
  const leaves = pruned.flatMap((n) => n.children).filter((n) => n.materials.length > 0);

  assert.equal(pruned.length, 1, 'категория остаётся: в её поддереве есть остаток');
  assert.equal(leaves.length, 1, 'вид работ без остатка убран');
  assert.equal(leaves[0]!.materials.length, 2, 'кран без остатка остался в показанном блоке');
  assert.deepEqual(pruneNodesByRows(tree, new Set()), [], 'остатка нет нигде — показывать нечего');
});

// ---------- признак «требует проверки» ----------

test('isReviewGroup: модельные оси и детерминированные замечания', () => {
  const empty = new Map<string, DimensionFinding>();
  const finding: DimensionFinding = { orderKey: 'k1', name: 'Кран', unit: 'шт', quantity: 1.5, suggested: 2 };

  assert.equal(isReviewGroup(dto(), empty), false, 'полная группа без несовместимостей — не в отборе');
  assert.equal(isReviewGroup(dto({ completeness: 'incomplete' }), empty), true);
  assert.equal(isReviewGroup(dto({ compatibility: 'possible_issue' }), empty), true);
  assert.equal(
    isReviewGroup(dto({ orderKeys: ['k1'] }), new Map([['k1', finding]])),
    true,
    'дробное количество прячется отбором, если его не учесть',
  );
  assert.equal(
    isReviewGroup(dto({ issues: [{ severity: 'recommendation', message: 'Проверьте марку', orderKeys: [] }] }), empty),
    true,
    'бейдж «Проверить» и отбор считают одно: иначе блок с бейджем исчезал при включении отбора',
  );
});

test('groupCheck: счёт замечаний, цвет по максимальному риску, обе оси в резюме', () => {
  const empty = new Map<string, DimensionFinding>();
  const finding: DimensionFinding = { orderKey: 'k1', name: 'Кран', unit: 'шт', quantity: 1.5, suggested: 2 };

  assert.equal(groupCheck(dto(), empty), null, 'благополучный блок — ни бейджа, ни панели');

  const axisOnly = groupCheck(dto({ completeness: 'unknown' }), empty)!;
  assert.equal(axisOnly.details, 0);
  assert.equal(axisOnly.count, 1, 'без конкретики бейдж всё равно зовёт открыть панель');
  assert.equal(axisOnly.color, 'gold');

  const both = groupCheck(dto({ completeness: 'incomplete', compatibility: 'possible_issue' }), empty)!;
  assert.deepEqual(
    both.axes,
    ['Возможные несовместимости', 'Неполный комплект'],
    'оси независимы — в панели видны обе причины',
  );
  assert.equal(both.color, 'red', 'красный сильнее оранжевого');

  const dim = groupCheck(dto({ orderKeys: ['k1'] }), new Map([['k1', finding]]))!;
  assert.equal(dim.color, 'orange', 'дробное количество при благополучных осях — не золотой');
  assert.deepEqual(dim.axes, [], 'модель претензий не имеет — резюме осей не показывается');
  assert.equal(dim.count, 1);

  const warn = groupCheck(dto({ issues: [{ severity: 'warning', message: 'Разные диаметры', orderKeys: [] }] }), empty)!;
  assert.equal(warn.color, 'orange');
  const tip = groupCheck(dto({ issues: [{ severity: 'recommendation', message: 'Проверьте марку', orderKeys: [] }] }), empty)!;
  assert.equal(tip.color, 'gold', 'рекомендация не выдаёт себя за предупреждение');

  const many = groupCheck(
    dto({
      orderKeys: ['k1'],
      completeness: 'incomplete',
      issues: [{ severity: 'warning', message: 'Разные диаметры', orderKeys: [] }],
      missing: [{ name: 'Прокладка', reason: 'нужна к фланцу', need: 'required' }],
    }),
    new Map([['k1', finding]]),
  )!;
  assert.equal(many.details, 3, 'размерность + замечание + пропуск');
  assert.equal(many.count, 3, 'резюме осей отдельным замечанием не считается');

  const visible = groupCheck(dto({ orderKeys: ['k1', 'k2'] }), new Map([['k1', finding]]), ['k2']);
  assert.equal(visible, null, 'у подрядчика размерность считается только по его строкам');
});

test('countReviewGroups: группы из чужих строк не в счёте', () => {
  const dimension = new Map<string, DimensionFinding>();
  const groups = [
    dto({ id: 'g1', completeness: 'incomplete', orderKeys: ['mine'] }),
    dto({ id: 'g2', completeness: 'incomplete', orderKeys: ['alien'] }),
  ];

  assert.equal(countReviewGroups(groups, new Set(['mine']), dimension), 1);
});
