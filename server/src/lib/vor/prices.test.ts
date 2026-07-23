import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  ANCHOR_COL,
  ANCHOR_DATA_START_ROW,
  ANCHOR_MARKER,
  ANCHOR_SHEET,
  BSM_SHEET,
  BSR_SHEET,
  CODE_MATERIAL,
  CODE_WORK,
  COL,
  KP_SHEET,
  REF_COL,
  REF_DATA_START_ROW,
} from '../estimate-export/layout.js';
import type { VorManifest } from '../estimate-export/vor-content.js';
import { matchVorPrices, parseFilledVorWorkbook, VorPriceParseError } from './prices.js';

const ITEM_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ITEM_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const MAT_1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const MAT_2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const VOR_ID = 'cccccccc-0000-4000-8000-000000000001';

// Снимок: две работы, у первой — один материал.
const manifest: VorManifest = {
  schemaVersion: 1,
  items: [
    {
      itemId: ITEM_1,
      name: 'Кладка стен',
      unit: 'м2',
      volume: 10,
      typeName: null,
      locations: [],
      locationLabel: 'Корпус 1',
      notes: null,
      materials: [{ materialId: MAT_1, name: 'Блок газобетонный', unit: 'м3', volume: 2, coef: 0.2 }],
    },
    {
      itemId: ITEM_2,
      name: 'Штукатурка',
      unit: 'м2',
      volume: 20,
      typeName: null,
      locations: [],
      locationLabel: 'Корпус 1',
      notes: null,
      materials: [],
    },
  ],
};

interface KpRowSpec {
  kind: 'work' | 'material';
  number: string;
  name: string;
  unit?: string | null;
  /** Значение ячейки цены в «КП»: число (константа), объект-формула или строка. */
  price?: ExcelJS.CellValue;
  anchor?: { itemId: string; materialId?: string | null };
}

/** Собрать книгу «как прислал подрядчик»: лист «КП», справочники и (опционально) якорь. */
function buildWorkbook(spec: {
  rows: KpRowSpec[];
  works?: Record<string, ExcelJS.CellValue>;
  materials?: Record<string, ExcelJS.CellValue>;
  vorId?: string;
  withAnchor?: boolean;
  skipKp?: boolean;
}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  if (!spec.skipKp) {
    const kp = wb.addWorksheet(KP_SHEET);
    // Строка-локация без кода — разбор обязан её пропустить.
    kp.getRow(1).getCell(COL.name).value = 'Корпус 1';
    const anchors: { row: number; kind: string; itemId: string; materialId: string | null }[] = [];
    spec.rows.forEach((r, i) => {
      const rowNum = 2 + i;
      const row = kp.getRow(rowNum);
      row.getCell(COL.num).value = r.number;
      row.getCell(COL.code).value = r.kind === 'work' ? CODE_WORK : CODE_MATERIAL;
      row.getCell(COL.name).value = r.name;
      row.getCell(COL.unit).value = r.unit ?? null;
      if (r.price !== undefined) {
        row.getCell(r.kind === 'work' ? COL.priceSmr : COL.priceMat).value = r.price;
      }
      if (r.anchor) {
        anchors.push({
          row: rowNum,
          kind: r.kind,
          itemId: r.anchor.itemId,
          materialId: r.anchor.materialId ?? null,
        });
      }
    });
    if (spec.withAnchor) {
      const a = wb.addWorksheet(ANCHOR_SHEET, { state: 'veryHidden' });
      a.getCell(1, 1).value = ANCHOR_MARKER;
      a.getCell(2, 1).value = spec.vorId ?? VOR_ID;
      anchors.forEach((an, i) => {
        const row = a.getRow(ANCHOR_DATA_START_ROW + i);
        row.getCell(ANCHOR_COL.row).value = an.row;
        row.getCell(ANCHOR_COL.kind).value = an.kind;
        row.getCell(ANCHOR_COL.itemId).value = an.itemId;
        row.getCell(ANCHOR_COL.materialId).value = an.materialId;
      });
    }
  }
  for (const [sheet, prices] of [
    [BSR_SHEET, spec.works],
    [BSM_SHEET, spec.materials],
  ] as const) {
    const ws = wb.addWorksheet(sheet);
    Object.entries(prices ?? {}).forEach(([name, price], i) => {
      const row = ws.getRow(REF_DATA_START_ROW + i);
      row.getCell(REF_COL.name).value = name;
      row.getCell(REF_COL.price).value = price;
    });
  }
  return wb;
}

const formula = (f: string, result?: number): ExcelJS.CellValue =>
  ({ formula: f, result } as unknown as ExcelJS.CellValue);

const positional: KpRowSpec[] = [
  { kind: 'work', number: '1', name: 'Кладка стен', unit: 'м2' },
  { kind: 'material', number: '1.1', name: 'Блок газобетонный', unit: 'м3' },
  { kind: 'work', number: '2', name: 'Штукатурка', unit: 'м2' },
];

test('цены берутся из листов «РАБОТЫ»/«МАТЕРИАЛЫ»', () => {
  const wb = buildWorkbook({
    rows: positional,
    works: { 'Кладка стен': 1500, Штукатурка: 700 },
    materials: { 'Блок газобетонный': 4200 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.equal(res.matchedBy, 'position');
  assert.deepEqual(res.works.map((w) => [w.itemId, w.price]), [[ITEM_1, 1500], [ITEM_2, 700]]);
  assert.deepEqual(res.materials.map((m) => [m.materialId, m.price]), [[MAT_1, 4200]]);
  assert.equal(res.unmatched.length, 0);
});

test('формула в «КП» ценой не считается — берём справочник', () => {
  const wb = buildWorkbook({
    rows: positional.map((r) => ({ ...r, price: formula('_xlfn.XLOOKUP(D2,РАБОТЫ!B:B,РАБОТЫ!E:E,0,0,1)', 99) })),
    works: { 'Кладка стен': 1500, Штукатурка: 700 },
    materials: { 'Блок газобетонный': 4200 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.deepEqual(res.works.map((w) => w.price), [1500, 700]);
  assert.deepEqual(res.materials.map((m) => m.price), [4200]);
});

test('константа в «КП» перебивает справочник', () => {
  const wb = buildWorkbook({
    rows: [
      { ...positional[0]!, price: 1234 },
      positional[1]!,
      positional[2]!,
    ],
    works: { 'Кладка стен': 1500, Штукатурка: 700 },
    materials: { 'Блок газобетонный': 4200 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.deepEqual(res.works.map((w) => w.price), [1234, 700]);
});

test('число с пробелами и запятой распознаётся, ноль — валидная цена', () => {
  const wb = buildWorkbook({
    rows: positional,
    works: { 'Кладка стен': '1 234,56', Штукатурка: 0 },
    materials: { 'Блок газобетонный': formula('=2000*2', 4000) },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.deepEqual(res.works.map((w) => w.price), [1234.56, 0]);
  assert.equal(res.works[1]!.reason, undefined, 'ноль не должен считаться отсутствующей ценой');
  assert.deepEqual(res.materials.map((m) => m.price), [4000]);
});

test('пустая цена и текст вместо цены помечаются разными причинами', () => {
  const wb = buildWorkbook({
    rows: positional,
    works: { 'Кладка стен': 'по договору' },
    materials: {},
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.equal(res.works[0]!.reason, 'bad_price');
  assert.equal(res.works[1]!.reason, 'no_price');
  assert.equal(res.materials[0]!.reason, 'no_price');
});

test('отрицательная цена не принимается', () => {
  const wb = buildWorkbook({ rows: positional, works: { 'Кладка стен': -5 } });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.equal(res.works[0]!.reason, 'bad_price');
});

test('одинаковые наименования получают общую цену справочника', () => {
  const twin: VorManifest = {
    schemaVersion: 1,
    items: [
      { ...manifest.items[0]!, itemId: ITEM_1, materials: [] },
      { ...manifest.items[0]!, itemId: ITEM_2, materials: [] },
    ],
  };
  const wb = buildWorkbook({
    rows: [
      { kind: 'work', number: '1', name: 'Кладка стен', unit: 'м2' },
      { kind: 'work', number: '2', name: 'Кладка стен', unit: 'м2' },
    ],
    works: { 'Кладка стен': 1500 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), twin);
  assert.deepEqual(res.works.map((w) => [w.itemId, w.price]), [[ITEM_1, 1500], [ITEM_2, 1500]]);
});

test('якорь: строки сопоставляются по UUID даже после перестановки', () => {
  const wb = buildWorkbook({
    withAnchor: true,
    rows: [
      { kind: 'work', number: '2', name: 'Штукатурка', unit: 'м2', anchor: { itemId: ITEM_2 } },
      { kind: 'work', number: '1', name: 'Кладка стен (уточнено)', unit: 'м2', anchor: { itemId: ITEM_1 } },
      { kind: 'material', number: '1.1', name: 'Блок', unit: 'м3', anchor: { itemId: ITEM_1, materialId: MAT_1 } },
    ],
    works: { Штукатурка: 700, 'Кладка стен (уточнено)': 1600 },
    materials: { Блок: 4200 },
  });
  const parsed = parseFilledVorWorkbook(wb);
  assert.equal(parsed.vorId, VOR_ID);
  const res = matchVorPrices(parsed, manifest);
  assert.equal(res.matchedBy, 'anchor');
  assert.deepEqual(res.works.map((w) => [w.itemId, w.price]), [[ITEM_2, 700], [ITEM_1, 1600]]);
  assert.deepEqual(res.materials.map((m) => [m.materialId, m.price]), [[MAT_1, 4200]]);
  assert.equal(res.unmatched.length, 0);
});

test('якорь на чужую строку сметы не сопоставляется', () => {
  const wb = buildWorkbook({
    withAnchor: true,
    rows: [{ kind: 'work', number: '1', name: 'Чужая работа', anchor: { itemId: 'dddddddd-0000-4000-8000-000000000009' } }],
    works: { 'Чужая работа': 100 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.equal(res.works.length, 0);
  assert.equal(res.unmatched[0]!.reason, 'not_matched');
});

test('позиционно: расхождение наименования выбрасывает только свою строку', () => {
  const wb = buildWorkbook({
    rows: [
      { kind: 'work', number: '1', name: 'Кладка стен ПЕРЕИМЕНОВАННАЯ', unit: 'м2' },
      { kind: 'material', number: '1.1', name: 'Блок газобетонный', unit: 'м3' },
      { kind: 'work', number: '2', name: 'Штукатурка', unit: 'м2' },
    ],
    works: { 'Кладка стен ПЕРЕИМЕНОВАННАЯ': 1500, Штукатурка: 700 },
    materials: { 'Блок газобетонный': 4200 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  // Работа не сошлась — вместе с ней выпадает и её материал, но вторая работа берётся.
  assert.deepEqual(res.works.map((w) => [w.itemId, w.price]), [[ITEM_2, 700]]);
  assert.equal(res.materials.length, 0);
  assert.deepEqual(res.unmatched.map((u) => u.reason), ['changed', 'changed']);
});

test('позиционно: изменившаяся единица измерения не даёт записать цену', () => {
  const wb = buildWorkbook({
    rows: [
      { kind: 'work', number: '1', name: 'Кладка стен', unit: 'м3' },
      { kind: 'material', number: '1.1', name: 'Блок газобетонный', unit: 'м3' },
      { kind: 'work', number: '2', name: 'Штукатурка', unit: 'м2' },
    ],
    works: { 'Кладка стен': 1500, Штукатурка: 700 },
    materials: { 'Блок газобетонный': 4200 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.deepEqual(res.works.map((w) => w.itemId), [ITEM_2]);
  assert.equal(res.unmatched[0]!.reason, 'changed');
});

test('позиционно: лишние строки в конце файла не сопоставляются', () => {
  const wb = buildWorkbook({
    rows: [...positional, { kind: 'work', number: '3', name: 'Добавленная подрядчиком', unit: 'м2' }],
    works: { 'Кладка стен': 1500, Штукатурка: 700, 'Добавленная подрядчиком': 999 },
    materials: { 'Блок газобетонный': 4200 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.equal(res.works.length, 2);
  assert.equal(res.unmatched[0]!.reason, 'not_matched');
});

test('регистр, ё и лишние пробелы в наименовании сопоставлению не мешают', () => {
  const wb = buildWorkbook({
    rows: [{ kind: 'work', number: '1', name: '  КЛАДКА   СТЕН ', unit: 'м2' }],
    works: { 'кладка стен': 1500 },
  });
  const res = matchVorPrices(parseFilledVorWorkbook(wb), manifest);
  assert.deepEqual(res.works.map((w) => [w.itemId, w.price]), [[ITEM_1, 1500]]);
});

test('файл без листа «КП» отвергается', () => {
  const wb = buildWorkbook({ rows: [], skipKp: true });
  assert.throws(() => parseFilledVorWorkbook(wb), VorPriceParseError);
});
