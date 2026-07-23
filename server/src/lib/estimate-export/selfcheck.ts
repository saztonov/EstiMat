// Оффлайн-проверка writer'а без БД: заполняем шаблон фикстурой и пишем файл в temp/,
// плюс проверяем дедуп МАТЕРИАЛЫ/РАБОТЫ и детект конфликтов единиц.
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
  REF_COL,
  KP_SHEET,
  COL,
  TABLE_START_ROW,
  CODE_WORK,
  CODE_MATERIAL,
  ITOGO_LABEL,
  NDS_LABEL,
  NOTE_COL_WIDTH,
  ANCHOR_SHEET,
  ANCHOR_MARKER,
  ANCHOR_DATA_START_ROW,
  ANCHOR_COL,
} from './layout.js';
import type { ExportBlock } from './data.js';
import {
  contentHash,
  diffItem,
  isSupportedSchemaVersion,
  VOR_CONTENT_SCHEMA_VERSION,
  type VorItemSnapshot,
} from './vor-content.js';

// Тестовый объект — проверяем автоподстановку названия/адреса в шапку (C5/C6).
const PROJECT = { name: 'ЖК Тестовый', address: 'г. Москва, ул. Тестовая, д. 1' };

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfcheck FAILED: ${msg}`);
}

// --- Хелперы для проверки подсветки (УФ) и обрезки диапазонов ---
// sqref правила УФ, чей первый адрес в указанной колонке (I/J/E/G/C) — или null, если правило снято.
function cfRefForColumn(ws: ExcelJS.Worksheet, column: string): string | null {
  const list = (ws as unknown as { conditionalFormattings?: { ref: string }[] }).conditionalFormattings ?? [];
  const hit = list.find((cf) => (/^\s*([A-Z]+)\d+/.exec(cf.ref)?.[1] ?? '') === column);
  return hit ? hit.ref : null;
}
function sameFill(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
// Последняя строка данных «КП» (без ИТОГО/НДС): TABLE_START_ROW + локации + детали − 1.
function kpTableLast(bs: ExportBlock[]): number {
  return TABLE_START_ROW + bs.length + bs.reduce((s, b) => s + b.rows.length, 0) - 1;
}
async function rawSheet(buffer: Buffer, path: string): Promise<string> {
  const z = await JSZip.loadAsync(buffer);
  return (await z.file(path)?.async('string')) ?? '';
}
interface Loaded {
  buf: Buffer;
  kp: ExcelJS.Worksheet;
  bsm: ExcelJS.Worksheet;
  bsr: ExcelJS.Worksheet;
}
async function loadScenario(bs: ExportBlock[]): Promise<Loaded> {
  const r = buildReferenceLists(bs);
  const buffer = await exportKpWorkbook(bs, { materials: r.materials, works: r.works }, PROJECT);
  const w = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await w.xlsx.load(buffer as any);
  return { buf: buffer, kp: w.getWorksheet(KP_SHEET)!, bsm: w.getWorksheet(BSM_SHEET)!, bsr: w.getWorksheet(BSR_SHEET)! };
}

// Фикстура: работа «Устройство стен из камня» (м2) и материал «Камень перегородочный» (м2)
// повторяются в двух блоках — должны схлопнуться в РАБОТЫ/МАТЕРИАЛЫ до одной строки.
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
assert(ref.materials.length === 2, `МАТЕРИАЛЫ: ожидалось 2 уникальных материала, получено ${ref.materials.length}`);
assert(ref.works.length === 2, `РАБОТЫ: ожидалось 2 уникальных работы, получено ${ref.works.length}`);
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

// 3) Записываем файл и перечитываем: справочники МАТЕРИАЛЫ/РАБОТЫ переименованы (старых БСМ/БСР
// нет), строк данных ровно столько же, есть формулы Объём (SUMIFS) / ИТОГО (=E*D) и строка-итог
// (SUBTOTAL), после итога стал. строк не осталось.
const buf = await exportKpWorkbook(blocks, { materials: ref.materials, works: ref.works }, PROJECT);
const wb = new ExcelJS.Workbook();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
await wb.xlsx.load(buf as any);
assert(BSM_SHEET === 'МАТЕРИАЛЫ' && BSR_SHEET === 'РАБОТЫ', 'листы-справочники должны называться МАТЕРИАЛЫ/РАБОТЫ');
assert(!wb.getWorksheet('БСМ') && !wb.getWorksheet('БСР'), 'старые листы БСМ/БСР должны отсутствовать');
const refFormula = (ws: ExcelJS.Worksheet, row: number, col: number): string => ws.getRow(row).getCell(col).formula ?? '';
for (const [sheet, list] of [
  [BSM_SHEET, ref.materials],
  [BSR_SHEET, ref.works],
] as const) {
  const ws = wb.getWorksheet(sheet);
  assert(!!ws, `в шаблоне нет листа «${sheet}»`);
  for (let i = 0; i < list.length; i++) {
    const rowNum = REF_DATA_START_ROW + i;
    const nameCell = ws!.getRow(rowNum).getCell(REF_COL.name).value;
    assert(String(nameCell ?? '') === list[i]!.name, `${sheet}: строка ${rowNum} ожидалась «${list[i]!.name}», получено «${String(nameCell ?? '')}»`);
    assert(/SUMIFS/.test(refFormula(ws!, rowNum, REF_COL.volume)), `${sheet}: в Объёме (D${rowNum}) нет SUMIFS`);
    assert(refFormula(ws!, rowNum, REF_COL.total).length > 0, `${sheet}: в ИТОГО (F${rowNum}) нет формулы =E*D`);
  }
  // Строка-итог сразу за данными: F = SUBTOTAL; наименование (B) пусто.
  const subRow = REF_DATA_START_ROW + list.length;
  assert(/SUBTOTAL/.test(refFormula(ws!, subRow, REF_COL.total)), `${sheet}: в строке-итоге (F${subRow}) нет SUBTOTAL`);
  const afterCell = ws!.getRow(subRow + 1).getCell(REF_COL.name).value;
  assert(afterCell == null || String(afterCell) === '', `${sheet}: после строки-итога остались стал. строки (B${subRow + 1} = «${String(afterCell)}»)`);
}

// 4) Лист КП: активный лист, уровни группировки, рамки J у материалов, формулы цен.
const kp = wb.getWorksheet(KP_SHEET);
assert(!!kp, 'нет листа КП');

// 4.0) Автоподстановка шапки: «Объект» (C5) и «Адрес объекта» (C6) из справочника «Проекты».
assert(String(kp!.getCell('C5').value ?? '') === PROJECT.name, `C5 (Объект): ожидалось «${PROJECT.name}», получено «${String(kp!.getCell('C5').value ?? '')}»`);
assert(String(kp!.getCell('C6').value ?? '') === PROJECT.address, `C6 (Адрес): ожидалось «${PROJECT.address}», получено «${String(kp!.getCell('C6').value ?? '')}»`);

// 4a) КП — активный лист (индекс 0), выделен только он. Проверяем по XML: ExcelJS при reload
// НЕ отдаёт tabSelected в worksheet.views, поэтому читаем готовый файл напрямую.
const zip = await JSZip.loadAsync(buf);
const wbXml = await zip.file('xl/workbook.xml')!.async('string');
assert(/activeTab="0"/.test(wbXml), `activeTab не 0: ${wbXml.match(/<workbookView[^>]*>/)?.[0]}`);
const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string'); // КП
const sheet2 = await zip.file('xl/worksheets/sheet2.xml')!.async('string'); // МАТЕРИАЛЫ
const sheet3 = await zip.file('xl/worksheets/sheet3.xml')!.async('string'); // РАБОТЫ
assert(/tabSelected="1"/.test(sheet1), 'у листа КП (sheet1) нет tabSelected="1"');
assert(!/tabSelected="1"/.test(sheet2) && !/tabSelected="1"/.test(sheet3), 'tabSelected остался у МАТЕРИАЛЫ/РАБОТЫ');

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
    // J (цена СМР) — XLOOKUP из «РАБОТЫ»; K/L/M/N — формулы.
    assert(/XLOOKUP/.test(formulaOf(row, COL.priceSmr)) && formulaOf(row, COL.priceSmr).includes(BSR_SHEET), `работа (строка ${row}): в J нет XLOOKUP на «РАБОТЫ»`);
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
    // I (цена материала) — XLOOKUP из «МАТЕРИАЛЫ».
    assert(/XLOOKUP/.test(formulaOf(row, COL.priceMat)) && formulaOf(row, COL.priceMat).includes(BSM_SHEET), `материал (строка ${row}): в I нет XLOOKUP на «МАТЕРИАЛЫ»`);
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

// 5) Подсветка ценовых колонок и обрезка диапазонов.
// 5a) Смешанный сценарий: работа с материалом, работа БЕЗ материалов, несколько локаций.
const mixed: ExportBlock[] = [
  {
    locationLabel: 'Локация A',
    rows: [
      { kind: 'work', number: '1', typeName: null, name: 'Работа с материалом', unit: 'м2', volume: 10, coef: null },
      { kind: 'material', number: '1.1', typeName: null, name: 'Материал один', unit: 'кг', volume: 10, coef: 1 },
      { kind: 'work', number: '2', typeName: null, name: 'Работа без материалов', unit: 'м2', volume: 5, coef: null },
    ],
  },
  {
    locationLabel: 'Локация B',
    rows: [
      { kind: 'work', number: '3', typeName: null, name: 'Ещё работа', unit: 'м3', volume: 2, coef: null },
      { kind: 'material', number: '3.1', typeName: null, name: 'Материал два', unit: 'шт', volume: 2, coef: 1 },
    ],
  },
];
{
  const s = await loadScenario(mixed);
  const tableLast = kpTableLast(mixed); // 24
  const cfI = cfRefForColumn(s.kp, 'I') ?? '';
  const cfJ = cfRefForColumn(s.kp, 'J') ?? '';
  // Находим строки: работа-без-материалов (I пусто) и любой материал (J пусто).
  let workNoMatRow = 0;
  let materialRow = 0;
  for (let row = TABLE_START_ROW; row <= tableLast; row++) {
    const code = String(s.kp.getRow(row).getCell(COL.code).value ?? '');
    const nextCode = String(s.kp.getRow(row + 1).getCell(COL.code).value ?? '');
    if (code === CODE_WORK && nextCode !== CODE_MATERIAL && !workNoMatRow) workNoMatRow = row;
    if (code === CODE_MATERIAL && !materialRow) materialRow = row;
  }
  assert(workNoMatRow > 0 && materialRow > 0, 'смешанный: не найдены строки работы-без-материалов/материала');
  // Формульные I/J попадают в подсветку.
  assert(/I19/.test(cfI) && /I20/.test(cfI), `смешанный: в CF I нет формульных ячеек: ${cfI}`);
  assert(/J19/.test(cfJ), `смешанный: в CF J нет формульной ячейки работы: ${cfJ}`);
  // Работа без материалов: I вне подсветки, заливка I = заливка H.
  assert(!new RegExp(`I${workNoMatRow}\\b`).test(cfI), `смешанный: I${workNoMatRow} (работа без мат.) не должна быть в CF: ${cfI}`);
  assert(
    sameFill(s.kp.getCell(`I${workNoMatRow}`).fill, s.kp.getCell(`H${workNoMatRow}`).fill),
    `смешанный: заливка I${workNoMatRow} должна совпадать с H${workNoMatRow}`,
  );
  // Материал: J вне подсветки, заливка J = заливка K.
  assert(!new RegExp(`J${materialRow}\\b`).test(cfJ), `смешанный: J${materialRow} (материал) не должна быть в CF: ${cfJ}`);
  assert(
    sameFill(s.kp.getCell(`J${materialRow}`).fill, s.kp.getCell(`K${materialRow}`).fill),
    `смешанный: заливка J${materialRow} должна совпадать с K${materialRow}`,
  );
  // Подсветка шапки C4:C7 не тронута; порог зелёного = 0.01.
  assert(cfRefForColumn(s.kp, 'C') === 'C4:C7', `смешанный: подсветка шапки C4:C7 изменена: ${cfRefForColumn(s.kp, 'C')}`);
  const kpXml = await rawSheet(s.buf, 'xl/worksheets/sheet1.xml');
  assert(/<formula>0\.01<\/formula>/.test(kpXml), 'смешанный: порог зелёного правила (0.01) не сохранён');
  // Автофильтр «КП» строго по данным (ИТОГО/НДС вне фильтра).
  assert(new RegExp(`<autoFilter ref="A17:O${tableLast}"`).test(kpXml), `смешанный: автофильтр КП не A17:O${tableLast}`);
  console.log('selfcheck подсветка КП ok: формулы в CF, нейтральная заливка H/K, C4:C7, порог 0.01, автофильтр');
}

// 5b) Сценарий без единого материала: лист МАТЕРИАЛЫ пуст (N=0), CF I у «КП» снят.
{
  const noMat: ExportBlock[] = [
    { locationLabel: 'L', rows: [{ kind: 'work', number: '1', typeName: null, name: 'Только работа', unit: 'м2', volume: 1, coef: null }] },
  ];
  const s = await loadScenario(noMat);
  assert(cfRefForColumn(s.kp, 'I') === null, 'без материалов: подсветку I на «КП» нужно снять (формул I нет)');
  assert(cfRefForColumn(s.kp, 'J') === 'J19', `без материалов: подсветка J должна быть J19, получено ${cfRefForColumn(s.kp, 'J')}`);
  const matXml = await rawSheet(s.buf, 'xl/worksheets/sheet2.xml');
  assert(/<autoFilter ref="A3:G3"/.test(matXml), 'без материалов: автофильтр МАТЕРИАЛЫ должен быть A3:G3');
  assert(!/<conditionalFormatting/.test(matXml), 'без материалов: на пустом листе МАТЕРИАЛЫ не должно остаться УФ');
  assert(/<dimension ref="A1:G3"\/>/.test(matXml), `без материалов: dimension МАТЕРИАЛЫ должен быть A1:G3: ${matXml.match(/<dimension[^>]*>/)?.[0]}`);
  console.log('selfcheck пустой справочник ok: CF I снят, автофильтр A3:G3, УФ убрано, dimension A1:G3');
}

// 5c) Крупнее шаблона (>11 материалов, >8 работ) — подсветка/фильтр НЕ «недотягиваются».
{
  const bigRows: ExportBlock['rows'] = [];
  for (let i = 1; i <= 10; i++) {
    bigRows.push({ kind: 'work', number: `${i}`, typeName: null, name: `Работа ${i}`, unit: 'м2', volume: i, coef: null });
    bigRows.push({ kind: 'material', number: `${i}.1`, typeName: null, name: `Материал ${i}`, unit: 'кг', volume: i, coef: 1 });
  }
  const big: ExportBlock[] = [{ locationLabel: 'Крупный корпус', rows: bigRows }];
  const s = await loadScenario(big);
  // 10 материалов и 10 работ: данные 4..13, строка-итог 14, dimension A1:G14.
  for (const [sheet, xmlPath] of [
    [s.bsm, 'xl/worksheets/sheet2.xml'],
    [s.bsr, 'xl/worksheets/sheet3.xml'],
  ] as const) {
    void sheet;
    const xml = await rawSheet(s.buf, xmlPath);
    assert(/<autoFilter ref="A3:G13"/.test(xml), `крупный: автофильтр ${xmlPath} должен тянуться до строки 13: ${xml.match(/<autoFilter[^>]*>/)?.[0]}`);
    assert(/sqref="E4:E13"/.test(xml), `крупный: УФ E ${xmlPath} должно тянуться до E13`);
    assert(/sqref="G4:G13"/.test(xml), `крупный: УФ G ${xmlPath} должно тянуться до G13`);
    assert(/<dimension ref="A1:G14"\/>/.test(xml), `крупный: dimension ${xmlPath} должен быть A1:G14: ${xml.match(/<dimension[^>]*>/)?.[0]}`);
    assert(!/<row r="(?:1[5-9]|[2-9]\d|\d{3,})"/.test(xml), `крупный: ${xmlPath} содержит строки ниже 14 (used range не обрезан)`);
  }
  console.log('selfcheck крупный экспорт ok: автофильтр/УФ/dimension тянутся до фактической строки, без недотягивания');
}

// 6) Служебный лист-якорь: без vorId его нет вовсе; с vorId — very hidden, с id ВОР и строками
//    «строка «КП» → UUID работы/материала». По нему заполненный подрядчиком файл узнаётся при
//    обратной загрузке договорных цен.
{
  const anchored: ExportBlock[] = [
    {
      locationLabel: 'Корпус 1',
      rows: [
        { kind: 'work', number: '1', typeName: null, name: 'Работа', unit: 'м2', volume: 3, coef: null, itemId: 'aaaaaaaa-0000-4000-8000-000000000001' },
        { kind: 'material', number: '1.1', typeName: null, name: 'Материал', unit: 'кг', volume: 3, coef: 1, itemId: 'aaaaaaaa-0000-4000-8000-000000000001', materialId: 'bbbbbbbb-0000-4000-8000-000000000001' },
      ],
    },
  ];
  const r = buildReferenceLists(anchored);
  const refs = { materials: r.materials, works: r.works };
  const vorId = 'cccccccc-0000-4000-8000-000000000001';

  const withoutAnchor = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withoutAnchor.xlsx.load((await exportKpWorkbook(anchored, refs, PROJECT)) as any);
  assert(!withoutAnchor.getWorksheet(ANCHOR_SHEET), 'без vorId служебного листа быть не должно');

  const wbA = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wbA.xlsx.load((await exportKpWorkbook(anchored, refs, PROJECT, vorId)) as any);
  const anchor = wbA.getWorksheet(ANCHOR_SHEET);
  assert(!!anchor, `лист ${ANCHOR_SHEET} не создан`);
  assert(anchor!.state === 'veryHidden', `лист ${ANCHOR_SHEET} должен быть veryHidden, получено ${anchor!.state}`);
  assert(String(anchor!.getCell(1, 1).value) === ANCHOR_MARKER, 'метка формата в A1 не совпала');
  assert(String(anchor!.getCell(2, 1).value) === vorId, 'id ВОР в A2 не совпал');
  const first = anchor!.getRow(ANCHOR_DATA_START_ROW);
  const second = anchor!.getRow(ANCHOR_DATA_START_ROW + 1);
  assert(Number(first.getCell(ANCHOR_COL.row).value) === TABLE_START_ROW + 1, 'первая якорная строка — работа под строкой-локацией');
  assert(String(first.getCell(ANCHOR_COL.kind).value) === 'work', 'вид первой якорной строки должен быть work');
  assert(String(second.getCell(ANCHOR_COL.materialId).value) === 'bbbbbbbb-0000-4000-8000-000000000001', 'materialId материала не совпал');
  // Видимые листы не пострадали: КП на месте и активен, справочники заполнены.
  assert(!!wbA.getWorksheet(KP_SHEET) && !!wbA.getWorksheet(BSM_SHEET) && !!wbA.getWorksheet(BSR_SHEET), 'видимые листы должны остаться');
  console.log('selfcheck якорь ok: лист very hidden, id ВОР, соответствие строк UUID');
}

// 7) Колонка «Примечание» (O): комментарии строки, следом состав работы из справочника — подряд,
//    без разделителя; ширина колонки расширена под этот текст, строка выросла по числу строк.
{
  const noteBlocks: ExportBlock[] = [
    {
      locationLabel: 'Корпус 1',
      rows: [
        { kind: 'work', number: '1', typeName: null, name: 'С комментарием и составом', unit: 'м2', volume: 1, coef: null,
          notes: 'Уточнить у ГИПа', composition: 'Очистка основания, грунтовка в два слоя, укладка плитки на клей.' },
        { kind: 'work', number: '2', typeName: null, name: 'Только состав', unit: 'м2', volume: 1, coef: null,
          composition: 'Разметка, монтаж каркаса.' },
        { kind: 'work', number: '3', typeName: null, name: 'Только комментарий', unit: 'м2', volume: 1, coef: null, notes: 'Без справочника' },
        { kind: 'work', number: '4', typeName: null, name: 'Без примечаний', unit: 'м2', volume: 1, coef: null },
      ],
    },
  ];
  const rN = buildReferenceLists(noteBlocks);
  const wbN = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wbN.xlsx.load((await exportKpWorkbook(noteBlocks, { materials: rN.materials, works: rN.works }, PROJECT)) as any);
  const kpN = wbN.getWorksheet(KP_SHEET)!;
  const noteAt = (offset: number) => String(kpN.getRow(TABLE_START_ROW + offset).getCell(COL.note).value ?? '');

  assert(
    noteAt(1) === 'Уточнить у ГИПа\nОчистка основания, грунтовка в два слоя, укладка плитки на клей.',
    `комментарий должен идти перед составом через перенос, получено «${noteAt(1)}»`,
  );
  assert(noteAt(2) === 'Разметка, монтаж каркаса.', `без комментариев печатается только состав, получено «${noteAt(2)}»`);
  assert(noteAt(3) === 'Без справочника', `без состава печатаются только комментарии, получено «${noteAt(3)}»`);
  assert(noteAt(4) === '', `у работы без примечаний ячейка O должна быть пустой, получено «${noteAt(4)}»`);
  assert(
    kpN.getColumn(COL.note).width === NOTE_COL_WIDTH,
    `ширина колонки O должна быть ${NOTE_COL_WIDTH}, получено ${kpN.getColumn(COL.note).width}`,
  );
  assert(
    (kpN.getRow(TABLE_START_ROW + 1).height ?? 0) >= 30,
    'строка с двумя строками примечания должна быть выше однострочной',
  );
  assert(
    kpN.getRow(TABLE_START_ROW + 1).getCell(COL.note).alignment?.wrapText === true,
    'у ячейки примечания должен быть включён перенос по словам',
  );
  console.log('selfcheck примечание ok: комментарии + состав работы, ширина O, высота строки');
}

// 8) Версионирование содержимого: v1 состав работы НЕ видит (иначе все ВОР, выгруженные до его
//    появления, разом стали бы «изменено»), v2 — видит. Это главная гарантия совместимости.
{
  const base: VorItemSnapshot = {
    itemId: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Устройство стен из камня',
    unit: 'м2',
    volume: 255.4,
    typeName: 'СВ-3.3',
    locations: [{ zoneId: null, floors: [2, 3] }],
    locationLabel: '',
    notes: 'Уточнить у ГИПа',
    materials: [],
  };
  const withComposition: VorItemSnapshot = { ...base, composition: 'Очистка основания, грунтовка.' };
  const otherComposition: VorItemSnapshot = { ...base, composition: 'Совсем другой состав.' };

  assert(
    contentHash(base, 1).equals(contentHash(withComposition, 1)),
    'v1: появление состава работы не должно менять хэш — иначе старые ВОР «краснеют»',
  );
  assert(
    !contentHash(base, 2).equals(contentHash(withComposition, 2)),
    'v2: состав работы обязан входить в хэш',
  );
  assert(
    !contentHash(withComposition, 2).equals(contentHash(otherComposition, 2)),
    'v2: правка состава в справочнике должна делать ВОР неактуальным',
  );
  assert(VOR_CONTENT_SCHEMA_VERSION === 2, 'новые ВОР должны выгружаться по схеме v2');
  assert(isSupportedSchemaVersion(1) && isSupportedSchemaVersion(2), 'обе версии схемы должны поддерживаться');

  // diff: у снимка v1 состава нет — сравнивать его нельзя, иначе каждая строка покажет ложное
  // «состав работы добавлен».
  const hasComposition = (version: number) =>
    diffItem(base, withComposition, version).fields.some((f) => f.key === 'composition');
  assert(!hasComposition(1), 'diff v1 не должен показывать изменение состава работы');
  assert(hasComposition(2), 'diff v2 должен показывать изменение состава работы');
  console.log('selfcheck версия содержимого ok: v1 состав игнорирует, v2 учитывает (хэш и diff)');
}

const out = resolve(process.cwd(), '..', 'temp', '__selfcheck_kp.xlsx');
await writeFile(out, buf);
console.log('selfcheck ok →', out, `(${buf.length} bytes)`);
