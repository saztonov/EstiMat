// Тесты чистой логики группировки: сходимость сумм и атомарность строки заказа.
// Проверяют то, что глазом на смете в 577 позиций не увидеть.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggKey, lineKey } from '@estimat/shared';
import type { LocationSnapshot } from '../../estimates/components/location';
import type {
  AggregatedMaterial,
  MaterialGroup,
  MaterialOccurrence,
} from '../../estimates/materials/aggregateMaterials';
import { buildOrderRows, type CategoryIndex } from './orderRow';
import { buildMaterialTree, flattenTreeRows, type MaterialLevelSettings } from './materialTree';

// Все комбинации уровней. Раньше здесь был список готовых пресетов из UI; пресеты убраны
// (переключатели остались), а инвариант обязан держаться при любом их сочетании.
const ALL_LEVEL_COMBOS: { label: string; levels: MaterialLevelSettings }[] = [true, false].flatMap((costType) =>
  [true, false].flatMap((location) =>
    [true, false].map((locationType) => ({
      label: `costType=${costType} location=${location} locationType=${locationType}`,
      levels: { costType, location, locationType },
    })),
  ),
);

// ---------- фикстуры ----------

const K1 = 'zone-k1';
const K2 = 'zone-k2';
const zoneIndex = new Map([
  [K1, 'Корпус 1'],
  [K2, 'Корпус 2'],
]);

function snap(zoneId: string | null, floors: number[], typeId: string | null = null): LocationSnapshot {
  return {
    locations: zoneId ? [{ zoneId, floors }] : [],
    zoneId,
    zoneName: zoneId ? (zoneIndex.get(zoneId) ?? null) : null,
    floorFrom: null,
    floorTo: null,
    locationTypeId: typeId,
    locationTypeName: typeId ? `тип ${typeId}` : null,
  };
}

let occSeq = 0;
function occ(quantity: number, total: number, location: LocationSnapshot, workId = `w${++occSeq}`): MaterialOccurrence {
  return {
    materialRowId: `mr${occSeq}`,
    workId,
    workName: `Работа ${workId}`,
    quantity,
    unit: 'шт',
    unitPrice: quantity > 0 ? total / quantity : 0,
    total,
    needsReview: false,
    status: 'confirmed',
    location,
  };
}

function agg(materialId: string | null, name: string, occurrences: MaterialOccurrence[]): AggregatedMaterial {
  const quantity = occurrences.reduce((s, o) => s + o.quantity, 0);
  const total = occurrences.reduce((s, o) => s + o.total, 0);
  return {
    key: aggKey(materialId, name, 'шт'),
    materialId,
    name,
    unit: 'шт',
    quantity,
    total,
    unitPrice: quantity > 0 ? total / quantity : 0,
    hasAi: false,
    hasNeedsReview: false,
    hasSuggested: false,
    occurrences,
  };
}

function group(costTypeId: string | null, costTypeName: string | null, materials: AggregatedMaterial[]): MaterialGroup {
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

/** Смета: труба в двух видах работ (одинаковое имя!), кран в двух локациях, материал без локации. */
function fixture(): MaterialGroup[] {
  occSeq = 0;
  return [
    group('ct-heat', 'Отопление', [
      agg('m-pipe', 'Труба Ду25', [occ(10, 1000, snap(K1, [1, 2], 't-rp1'))]),
      // Один материал из двух локаций — сигнатура составная, строка остаётся ОДНА.
      agg('m-valve', 'Кран шаровый', [occ(4, 400, snap(K1, [1], 't-rp1')), occ(6, 600, snap(K2, [3], 't-rp1'))]),
      agg(null, 'Герметик', [occ(2, 50, snap(null, []))]),
    ]),
    group('ct-water', 'Водоснабжение', [
      // Тот же материал, другой вид работ → другой ключ заказа, две отдельные строки.
      agg('m-pipe', 'Труба Ду25', [occ(7, 700, snap(K2, [3], 't-mop'))]),
    ]),
  ];
}

const rowsOf = () => buildOrderRows(fixture(), categoryIndex, zoneIndex);
const sum = (xs: { quantity: number; total: number }[]) => ({
  quantity: xs.reduce((s, x) => s + x.quantity, 0),
  total: xs.reduce((s, x) => s + x.total, 0),
});

// ---------- сходимость ----------

test('дерево сохраняет количество и сумму при любом сочетании уровней', () => {
  const rows = rowsOf();
  const expected = sum(rows);
  for (const preset of ALL_LEVEL_COMBOS) {
    const leaves = flattenTreeRows(buildMaterialTree(rows, preset.levels));
    const actual = sum(leaves);
    assert.equal(leaves.length, rows.length, `${preset.label}: строк в дереве`);
    assert.ok(Math.abs(actual.quantity - expected.quantity) < 1e-9, `${preset.label}: количество`);
    assert.ok(Math.abs(actual.total - expected.total) < 1e-9, `${preset.label}: сумма`);
  }
});

test('каждый ключ заказа встречается в дереве ровно один раз при любом сочетании уровней', () => {
  const rows = rowsOf();
  for (const preset of ALL_LEVEL_COMBOS) {
    const leaves = flattenTreeRows(buildMaterialTree(rows, preset.levels));
    const keys = leaves.map((r) => r.orderKey);
    assert.equal(new Set(keys).size, keys.length, `${preset.label}: ключи задвоены`);
  }
});

// ---------- атомарность строки ----------

test('материал из нескольких локаций не дублируется: одна строка, составная сигнатура', () => {
  const rows = rowsOf();
  const valve = rows.filter((r) => r.name === 'Кран шаровый');
  assert.equal(valve.length, 1, 'кран должен быть одной строкой');
  assert.equal(valve[0]!.quantity, 10, 'количество — сумма по обеим локациям, без задвоения');
  assert.ok(valve[0]!.locationSig.includes(';'), 'сигнатура объединяет две локации');

  // При включённом уровне «Локация» он всё равно попадает ровно в один узел.
  const withLocation: MaterialLevelSettings = { costType: true, location: true, locationType: true };
  const leaves = flattenTreeRows(buildMaterialTree(rows, withLocation));
  assert.equal(leaves.filter((r) => r.name === 'Кран шаровый').length, 1);
});

test('одинаковый материал из разных видов работ — две строки с разными ключами', () => {
  const rows = rowsOf();
  const pipes = rows.filter((r) => r.name === 'Труба Ду25');
  assert.equal(pipes.length, 2);
  assert.notEqual(pipes[0]!.orderKey, pipes[1]!.orderKey);

  // Даже когда уровень «Вид работ» выключен и строки стоят рядом — они не сливаются.
  const flat: MaterialLevelSettings = { costType: false, location: false, locationType: false };
  const leaves = flattenTreeRows(buildMaterialTree(rows, flat));
  assert.equal(leaves.filter((r) => r.name === 'Труба Ду25').length, 2);
});

test('ключ заказа строки = lineKey(costTypeId, aggKey)', () => {
  const rows = rowsOf();
  for (const r of rows) assert.equal(r.orderKey, lineKey(r.costTypeId, r.key));
});

// ---------- структура дерева ----------

test('выключенный уровень исчезает из дерева, включённый — появляется', () => {
  const rows = rowsOf();
  const depth = (levels: MaterialLevelSettings) => {
    let d = 0;
    let node = buildMaterialTree(rows, levels)[0];
    while (node) {
      d += 1;
      node = node.children[0];
    }
    return d;
  };
  assert.equal(depth({ costType: false, location: false, locationType: false }), 1, 'только категория');
  assert.equal(depth({ costType: true, location: false, locationType: false }), 2, 'категория → вид работ');
  assert.equal(depth({ costType: true, location: true, locationType: true }), 4, 'все уровни');
});

test('узлы «Без локации» и «Без типа» уходят в конец списка', () => {
  const rows = rowsOf();
  const tree = buildMaterialTree(rows, { costType: false, location: true, locationType: false });
  const heat = tree[0]!;
  const last = heat.children[heat.children.length - 1]!;
  assert.equal(last.label, 'Без локации', 'корзина без локации должна быть последней');
});
