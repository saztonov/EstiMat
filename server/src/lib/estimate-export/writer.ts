// Заполнение шаблона «КП» данными сметы через ExcelJS.
//
// Стратегия — template-injection: шаблон (шапка, стили, merge, листы-справочники
// БСМ/БСР, статичный «хвост» с условиями) берётся как скелет; переписывается ТОЛЬКО
// динамическая таблица (строки локаций/работ/материалов) и строки ИТОГО/НДС. Формулы
// строятся по индексу строки — ExcelJS сам ссылки не сдвигает. Число строк подгоняется
// spliceRows, «хвост» уезжает блоком (merge сдвигаются корректно — проверено).
//
// Значения из БД: тип, наименование, ед.изм., объём, коэффициент. Цены (I/J) пустые —
// их заполняет подрядчик; стоимости (K,L,M,N) и подытоги — живые формулы.

import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  COL,
  KP_SHEET,
  TABLE_START_ROW,
  TAIL_START_ROW,
  DYN_TEMPLATE_ROWS,
  STYLE_ROW,
  CODE_WORK,
  CODE_MATERIAL,
  ITOGO_LABEL,
  NDS_LABEL,
  colLetter,
  BSM_SHEET,
  BSR_SHEET,
  REF_DATA_START_ROW,
  REF_COL,
} from './layout.js';
import type { ExportBlock } from './data.js';
import type { ExportRefRow } from './references.js';
import { sanitizeXlsx } from './sanitize.js';

const TEMPLATE_FILE = 'kp-export-template.xlsx';
const __dirname = dirname(fileURLToPath(import.meta.url));

// В prod writer.ts инлайнится в dist/index.js (__dirname=dist → dist/templates);
// в dev tsx он лежит в src/lib/estimate-export (__dirname → ../../templates = src/templates).
function resolveTemplatePath(): string {
  const candidates = [
    join(__dirname, 'templates', TEMPLATE_FILE),
    join(__dirname, '..', '..', 'templates', TEMPLATE_FILE),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Шаблон экспорта не найден: ${candidates.join(' | ')}`);
  return found;
}

type CellStyle = Partial<ExcelJS.Style>;
// Снимок стилей строки-образца по колонкам (1..maxCol).
function captureRowStyle(ws: ExcelJS.Worksheet, rowNumber: number, maxCol: number = COL.note): CellStyle[] {
  const row = ws.getRow(rowNumber);
  const styles: CellStyle[] = [];
  for (let c = 1; c <= maxCol; c++) {
    styles[c] = JSON.parse(JSON.stringify(row.getCell(c).style ?? {}));
  }
  return styles;
}

function applyRowStyle(row: ExcelJS.Row, styles: CellStyle[], maxCol: number = COL.note): void {
  for (let c = 1; c <= maxCol; c++) {
    if (styles[c]) row.getCell(c).style = styles[c] as ExcelJS.Style;
  }
}

// Заполнить лист-справочник (БСМ/БСР) уникальными строками: A=№, B=наименование, C=ед.изм.,
// D — очистить (цену заполняет подрядчик; заодно убирается старый XLOOKUP из образца).
// Не используем spliceRows (в шаблоне БСМ раздут rowCount, а splice ведёт себя ненадёжно):
// стиль снимаем со строки-образца, пишем строки поверх, лишние старые строки-образцы чистим
// по значению. Число образцовых строк определяем сканом сплошного блока наименований.
function fillReferenceSheet(ws: ExcelJS.Worksheet, dataStartRow: number, rows: ExportRefRow[]): void {
  const maxCol = REF_COL.price;
  const styleRow = captureRowStyle(ws, dataStartRow, maxCol);

  // Последняя существующая строка данных — сплошной блок наименований от dataStartRow.
  let lastExisting = dataStartRow - 1;
  for (let r = dataStartRow; r < dataStartRow + 5000; r++) {
    const v = ws.getRow(r).getCell(REF_COL.name).value;
    if (v == null || String(v).trim() === '') break;
    lastExisting = r;
  }

  rows.forEach((item, i) => {
    const row = ws.getRow(dataStartRow + i);
    applyRowStyle(row, styleRow, maxCol);
    row.getCell(REF_COL.num).value = i + 1;
    row.getCell(REF_COL.name).value = item.name;
    row.getCell(REF_COL.unit).value = item.unit ?? null;
    row.getCell(REF_COL.price).value = null;
  });

  // Очистить оставшиеся строки-образцы (значения) ниже записанных.
  const lastWritten = dataStartRow + rows.length - 1;
  for (let r = Math.max(dataStartRow, lastWritten + 1); r <= lastExisting; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) row.getCell(c).value = null;
  }
}

const L = colLetter(COL.costMat); //  L
const M = colLetter(COL.costSmr); //  M
const N = colLetter(COL.costTotal); // N
const I = colLetter(COL.priceMat); //  I
const J = colLetter(COL.priceSmr); //  J

/** Собрать .xlsx (Buffer): заполнить лист «КП» блоками и листы-справочники БСМ/БСР. */
export async function exportKpWorkbook(
  blocks: ExportBlock[],
  refs: { materials: ExportRefRow[]; works: ExportRefRow[] },
): Promise<Buffer> {
  const templateBuf = await readFile(resolveTemplatePath());
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(templateBuf as any);
  const ws = wb.getWorksheet(KP_SHEET);
  if (!ws) throw new Error(`В шаблоне нет листа «${KP_SHEET}»`);

  // Снимки стилей строк-образцов ДО сдвига строк (splice их подвинет/удалит).
  const style = {
    location: captureRowStyle(ws, STYLE_ROW.location),
    work: captureRowStyle(ws, STYLE_ROW.work),
    material: captureRowStyle(ws, STYLE_ROW.material),
    itogo: captureRowStyle(ws, STYLE_ROW.itogo),
    nds: captureRowStyle(ws, STYLE_ROW.nds),
  };

  // Сколько строк займёт динамическая зона: по каждому блоку строка-локация + её строки,
  // плюс ИТОГО и НДС.
  const detailRowsTotal = blocks.reduce((s, b) => s + b.rows.length, 0);
  const totalGen = blocks.length + detailRowsTotal + 2;

  // Подогнать число строк зоны под totalGen: хвост уедет вниз/вверх блоком.
  const delta = totalGen - DYN_TEMPLATE_ROWS;
  if (delta > 0) {
    ws.spliceRows(TAIL_START_ROW, 0, ...Array.from({ length: delta }, () => []));
  } else if (delta < 0) {
    ws.spliceRows(TABLE_START_ROW + totalGen, -delta);
  }

  const setFormula = (row: ExcelJS.Row, col: number, formula: string) => {
    row.getCell(col).value = { formula };
  };

  let r = TABLE_START_ROW;
  for (const block of blocks) {
    const locRow = ws.getRow(r);
    applyRowStyle(locRow, style.location);
    locRow.getCell(COL.name).value = block.locationLabel;
    const detailFirst = r + 1;
    const detailLast = r + block.rows.length;
    // Подытог локации: SUBTOTAL(9,…) по её строкам (материалы без стоимости не мешают).
    setFormula(locRow, COL.costMat, `SUBTOTAL(9,${L}${detailFirst}:${L}${detailLast})`);
    setFormula(locRow, COL.costSmr, `SUBTOTAL(9,${M}${detailFirst}:${M}${detailLast})`);
    setFormula(locRow, COL.costTotal, `SUBTOTAL(9,${N}${detailFirst}:${N}${detailLast})`);
    r += 1;

    for (const item of block.rows) {
      const row = ws.getRow(r);
      const isWork = item.kind === 'work';
      applyRowStyle(row, isWork ? style.work : style.material);
      row.getCell(COL.num).value = item.number;
      row.getCell(COL.code).value = isWork ? CODE_WORK : CODE_MATERIAL;
      row.getCell(COL.type).value = item.typeName ?? null;
      row.getCell(COL.name).value = item.name;
      row.getCell(COL.unit).value = item.unit ?? null;
      row.getCell(COL.volume).value = item.volume ?? null;
      if (!isWork) row.getCell(COL.coef).value = item.coef ?? null;
      if (isWork) {
        // Цены I/J пустые; цена-итого и стоимости — живые формулы.
        setFormula(row, COL.priceTotal, `SUM(${I}${r}:${J}${r})`);
        setFormula(row, COL.costMat, `${I}${r}*${colLetter(COL.volume)}${r}`);
        setFormula(row, COL.costSmr, `${J}${r}*${colLetter(COL.volume)}${r}`);
        setFormula(row, COL.costTotal, `SUM(${L}${r}:${M}${r})`);
      }
      r += 1;
    }
  }

  // ИТОГО и «в т.ч. НДС».
  const tableLast = r - 1;
  const itogoRow = ws.getRow(r);
  applyRowStyle(itogoRow, style.itogo);
  itogoRow.getCell(COL.name).value = ITOGO_LABEL;
  setFormula(itogoRow, COL.costMat, `SUBTOTAL(9,${L}${TABLE_START_ROW}:${L}${tableLast})`);
  setFormula(itogoRow, COL.costSmr, `SUBTOTAL(9,${M}${TABLE_START_ROW}:${M}${tableLast})`);
  setFormula(itogoRow, COL.costTotal, `SUBTOTAL(9,${N}${TABLE_START_ROW}:${N}${tableLast})`);
  const itogoRowNum = r;
  r += 1;

  const ndsRow = ws.getRow(r);
  applyRowStyle(ndsRow, style.nds);
  ndsRow.getCell(COL.name).value = NDS_LABEL;
  setFormula(ndsRow, COL.costMat, `${L}${itogoRowNum}/122*22`);
  setFormula(ndsRow, COL.costSmr, `${M}${itogoRowNum}/122*22`);
  setFormula(ndsRow, COL.costTotal, `${N}${itogoRowNum}/122*22`);

  // Листы-справочники БСМ (материалы) и БСР (работы) — уникальные наименования с ед.изм.
  const bsm = wb.getWorksheet(BSM_SHEET);
  if (bsm) fillReferenceSheet(bsm, REF_DATA_START_ROW, refs.materials);
  const bsr = wb.getWorksheet(BSR_SHEET);
  if (bsr) fillReferenceSheet(bsr, REF_DATA_START_ROW, refs.works);

  const out = await wb.xlsx.writeBuffer();
  return sanitizeXlsx(Buffer.from(out as ArrayBuffer));
}
