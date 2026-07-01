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
} from './layout.js';
import type { ExportBlock } from './data.js';
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
// Снимок стилей строки-образца по колонкам (1..COL.note).
function captureRowStyle(ws: ExcelJS.Worksheet, rowNumber: number): CellStyle[] {
  const row = ws.getRow(rowNumber);
  const styles: CellStyle[] = [];
  for (let c = 1; c <= COL.note; c++) {
    styles[c] = JSON.parse(JSON.stringify(row.getCell(c).style ?? {}));
  }
  return styles;
}

function applyRowStyle(row: ExcelJS.Row, styles: CellStyle[]): void {
  for (let c = 1; c <= COL.note; c++) {
    if (styles[c]) row.getCell(c).style = styles[c] as ExcelJS.Style;
  }
}

const L = colLetter(COL.costMat); //  L
const M = colLetter(COL.costSmr); //  M
const N = colLetter(COL.costTotal); // N
const I = colLetter(COL.priceMat); //  I
const J = colLetter(COL.priceSmr); //  J

/** Собрать .xlsx (Buffer) из блоков строк, заполнив шаблон «КП». */
export async function exportKpWorkbook(blocks: ExportBlock[]): Promise<Buffer> {
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

  const out = await wb.xlsx.writeBuffer();
  return sanitizeXlsx(Buffer.from(out as ArrayBuffer));
}
