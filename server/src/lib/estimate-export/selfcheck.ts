// Оффлайн-проверка writer'а без БД: заполняем шаблон фикстурой и пишем файл в temp/,
// плюс проверяем дедуп БСМ/БСР и детект конфликтов единиц.
// Запуск: npm run test:export -w server (npx tsx server/src/lib/estimate-export/selfcheck.ts)
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportKpWorkbook } from './writer.js';
import { buildReferenceLists, buildUnitAliasMap } from './references.js';
import {
  BSM_SHEET,
  BSR_SHEET,
  REF_DATA_START_ROW,
  KP_SHEET,
  COL,
  TABLE_START_ROW,
  CODE_WORK,
  CODE_MATERIAL,
  ITOGO_LABEL,
  NDS_LABEL,
} from './layout.js';
import type { ExportBlock } from './data.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfcheck FAILED: ${msg}`);
}

// Фикстура: работа «Устройство стен из камня» (м2) и материал «Камень перегородочный» (м2)
// повторяются в двух блоках — должны схлопнуться в БСР/БСМ до одной строки.
const blocks: ExportBlock[] = [
  {
    locationLabel: 'Корпус 2 · эт. 2-11',
    rows: [
      { kind: 'work', number: '1', typeName: 'СВ-3.3', name: 'Устройство стен из камня', unit: 'м2', volume: 255.4, coef: null },
      { kind: 'material', number: '1.1', typeName: null, name: 'Камень перегородочный', unit: 'м2', volume: 255.4, coef: 1 },
      { kind: 'work', number: '2', typeName: 'СВ-3.4', name: 'Устройство шахт', unit: 'м2', volume: 44.2, coef: null },
      { kind: 'material', number: '2.1', typeName: null, name: 'Камень полнотелый', unit: 'м2', volume: 44.2, coef: 1 },
    ],
  },
  {
    locationLabel: 'Корпус 3 · эт. 2-18',
    rows: [
      { kind: 'work', number: '3', typeName: 'СВ-3.3', name: 'Устройство стен из камня', unit: 'м2', volume: 1023.9, coef: null },
      { kind: 'material', number: '3.1', typeName: null, name: 'Камень перегородочный', unit: 'м2', volume: 1023.9, coef: 1 },
    ],
  },
];

// 1) Дедуп без конфликтов: по 2 уникальных работы/материала, конфликтов нет.
const ref = buildReferenceLists(blocks);
assert(ref.materials.length === 2, `БСМ: ожидалось 2 уникальных материала, получено ${ref.materials.length}`);
assert(ref.works.length === 2, `БСР: ожидалось 2 уникальных работы, получено ${ref.works.length}`);
assert(ref.conflicts.length === 0, `конфликтов быть не должно, получено ${ref.conflicts.length}`);

// 2) Конфликт единиц: тот же материал с разными ед.изм. → конфликт; в списке берётся первая.
const conflictBlocks: ExportBlock[] = [
  {
    locationLabel: 'Тест',
    rows: [
      { kind: 'work', number: '1', typeName: null, name: 'Кладка', unit: 'м2', volume: 1, coef: null },
      { kind: 'material', number: '1.1', typeName: null, name: 'Камень перегородочный', unit: 'м2', volume: 1, coef: 1 },
      { kind: 'work', number: '2', typeName: null, name: 'Кладка', unit: 'м2', volume: 1, coef: null },
      { kind: 'material', number: '2.1', typeName: null, name: 'Камень перегородочный', unit: 'шт', volume: 1, coef: 1 },
    ],
  },
];
const refC = buildReferenceLists(conflictBlocks);
assert(refC.conflicts.length === 1, `ожидался 1 конфликт, получено ${refC.conflicts.length}`);

// 2b) «м²» и «м2» — одна единица (надстрочная цифра), конфликта быть не должно.
const supBlocks: ExportBlock[] = [
  {
    locationLabel: 'Тест',
    rows: [
      { kind: 'material', number: '1.1', typeName: null, name: 'Плёнка', unit: 'м²', volume: 1, coef: 1 },
      { kind: 'material', number: '2.1', typeName: null, name: 'Плёнка', unit: 'м2', volume: 1, coef: 1 },
    ],
  },
];
const refSup = buildReferenceLists(supBlocks);
assert(refSup.conflicts.length === 0, `«м²»/«м2» не должны конфликтовать, получено ${refSup.conflicts.length}`);
assert(refSup.materials.length === 1, `«м²»/«м2» должны схлопнуться в 1 материал, получено ${refSup.materials.length}`);

// 2c) Синонимы из справочника: «шт» и «шт.» — одна единица, конфликта нет; без карты — конфликт.
const synBlocks: ExportBlock[] = [
  {
    locationLabel: 'Тест',
    rows: [
      { kind: 'material', number: '1.1', typeName: null, name: 'Дюбель', unit: 'шт', volume: 1, coef: 1 },
      { kind: 'material', number: '2.1', typeName: null, name: 'Дюбель', unit: 'шт.', volume: 1, coef: 1 },
    ],
  },
];
assert(buildReferenceLists(synBlocks).conflicts.length === 1, 'без справочника «шт»/«шт.» — конфликт');
const aliases = buildUnitAliasMap([{ name: 'шт', synonyms: ['шт.', 'штука'] }]);
const refSyn = buildReferenceLists(synBlocks, aliases);
assert(refSyn.conflicts.length === 0, `с синонимами «шт»/«шт.» не должны конфликтовать, получено ${refSyn.conflicts.length}`);
assert(refC.conflicts[0]!.kind === 'material', 'конфликт должен быть по материалу');
assert(
  refC.conflicts[0]!.units.includes('м2') && refC.conflicts[0]!.units.includes('шт'),
  `в конфликте ожидались ед. м2 и шт, получено ${refC.conflicts[0]!.units.join(', ')}`,
);
assert(refC.materials.length === 1, `при пропуске конфликта материал схлопывается в 1 строку, получено ${refC.materials.length}`);
assert(refC.materials[0]!.unit === 'м2', `берётся первая ед.изм. (м2), получено ${refC.materials[0]!.unit}`);

// 3) Записываем файл и перечитываем: строк данных БСМ/БСР ровно столько же, стал. строк не осталось.
const buf = await exportKpWorkbook(blocks, { materials: ref.materials, works: ref.works });
const wb = new ExcelJS.Workbook();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
await wb.xlsx.load(buf as any);
for (const [sheet, list] of [
  [BSM_SHEET, ref.materials],
  [BSR_SHEET, ref.works],
] as const) {
  const ws = wb.getWorksheet(sheet);
  assert(!!ws, `в шаблоне нет листа «${sheet}»`);
  for (let i = 0; i < list.length; i++) {
    const nameCell = ws!.getRow(REF_DATA_START_ROW + i).getCell(2).value;
    assert(String(nameCell ?? '') === list[i]!.name, `${sheet}: строка ${REF_DATA_START_ROW + i} ожидалась «${list[i]!.name}», получено «${String(nameCell ?? '')}»`);
  }
  const afterCell = ws!.getRow(REF_DATA_START_ROW + list.length).getCell(2).value;
  assert(afterCell == null || String(afterCell) === '', `${sheet}: после данных остались стал. строки (B${REF_DATA_START_ROW + list.length} = «${String(afterCell)}»)`);
}

// 4) Лист КП: активный лист, уровни группировки, рамки J у материалов, формулы цен.
const kp = wb.getWorksheet(KP_SHEET);
assert(!!kp, 'нет листа КП');

// 4a) КП — активный лист (индекс 0), выделен только он. Проверяем по XML: ExcelJS при reload
// НЕ отдаёт tabSelected в worksheet.views, поэтому читаем готовый файл напрямую.
const zip = await JSZip.loadAsync(buf);
const wbXml = await zip.file('xl/workbook.xml')!.async('string');
assert(/activeTab="0"/.test(wbXml), `activeTab не 0: ${wbXml.match(/<workbookView[^>]*>/)?.[0]}`);
const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string'); // КП
const sheet2 = await zip.file('xl/worksheets/sheet2.xml')!.async('string'); // БСМ
const sheet3 = await zip.file('xl/worksheets/sheet3.xml')!.async('string'); // БСР
assert(/tabSelected="1"/.test(sheet1), 'у листа КП (sheet1) нет tabSelected="1"');
assert(!/tabSelected="1"/.test(sheet2) && !/tabSelected="1"/.test(sheet3), 'tabSelected остался у БСМ/БСР');

// 4b/c/d) обход строк динамической зоны: тип строки → ожидаемый outlineLevel, рамки, формулы.
const totalGen = blocks.length + blocks.reduce((s, b) => s + b.rows.length, 0) + 2;
const lastRow = TABLE_START_ROW + totalGen - 1;
const formulaOf = (row: number, col: number): string => kp!.getRow(row).getCell(col).formula ?? '';
let workWithMat = 0;
let materialsSeen = 0;
for (let row = TABLE_START_ROW; row <= lastRow; row++) {
  const rr = kp!.getRow(row);
  const code = String(rr.getCell(COL.code).value ?? '');
  const name = String(rr.getCell(COL.name).value ?? '');

  if (name === ITOGO_LABEL || name === NDS_LABEL) {
    assert(rr.outlineLevel === 0, `строка ${row} (${name}): outlineLevel ${rr.outlineLevel}, ожидался 0`);
  } else if (code === CODE_WORK) {
    assert(rr.outlineLevel === 1, `работа (строка ${row}): outlineLevel ${rr.outlineLevel}, ожидался 1`);
    // J (цена СМР) — XLOOKUP из БСР; K/L/M/N — формулы.
    assert(/XLOOKUP/.test(formulaOf(row, COL.priceSmr)) && formulaOf(row, COL.priceSmr).includes(BSR_SHEET), `работа (строка ${row}): в J нет XLOOKUP на БСР`);
    for (const c of [COL.priceTotal, COL.costMat, COL.costSmr, COL.costTotal]) {
      assert(formulaOf(row, c).length > 0, `работа (строка ${row}): нет формулы в колонке ${c}`);
    }
    // Есть материалы (следующая строка — материал) → цена материалов работы (I) = SUMPRODUCT.
    if (String(kp!.getRow(row + 1).getCell(COL.code).value ?? '') === CODE_MATERIAL) {
      assert(/SUMPRODUCT/.test(formulaOf(row, COL.priceMat)), `работа (строка ${row}): в I нет SUMPRODUCT по материалам`);
      workWithMat += 1;
    }
  } else if (code === CODE_MATERIAL) {
    assert(rr.outlineLevel === 2, `материал (строка ${row}): outlineLevel ${rr.outlineLevel}, ожидался 2`);
    // I (цена материала) — XLOOKUP из БСМ.
    assert(/XLOOKUP/.test(formulaOf(row, COL.priceMat)) && formulaOf(row, COL.priceMat).includes(BSM_SHEET), `материал (строка ${row}): в I нет XLOOKUP на БСМ`);
    // J у материала — с рамкой (как у соседей).
    const b = rr.getCell(COL.priceSmr).border;
    assert(!!(b && b.top && b.bottom && b.left && b.right), `материал (строка ${row}): у J нет рамки`);
    materialsSeen += 1;
  } else {
    assert(rr.outlineLevel === 0, `локация (строка ${row}): outlineLevel ${rr.outlineLevel}, ожидался 0`);
  }
}
assert(workWithMat === 3, `ожидалось 3 работы с материалами, получено ${workWithMat}`);
assert(materialsSeen === 3, `ожидалось 3 материала, получено ${materialsSeen}`);

// 4e) в готовом XML листа КП нет collapsed="1" (снято в sanitize), но outlineLevel сохранён.
assert(!/collapsed="1"/.test(sheet1), 'в xl/worksheets/sheet1.xml остался collapsed="1"');
assert(/outlineLevel="2"/.test(sheet1), 'в sheet1.xml нет outlineLevel="2" (группировка не проставлена)');
assert(/summaryBelow="0"/.test(sheet1), 'в sheet1.xml summaryBelow не 0 (итог группы не сверху)');
console.log('selfcheck КП ok: activeTab, группировка, рамки J, формулы, collapsed сняты');

const out = resolve(process.cwd(), '..', 'temp', '__selfcheck_kp.xlsx');
await writeFile(out, buf);
console.log('selfcheck ok →', out, `(${buf.length} bytes)`);
