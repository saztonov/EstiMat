// Заполнение шаблона «КП» данными сметы через ExcelJS.
//
// Стратегия — template-injection: шаблон (шапка, стили, merge, листы-справочники
// МАТЕРИАЛЫ/РАБОТЫ, статичный «хвост» с условиями) берётся как скелет; переписывается ТОЛЬКО
// динамическая таблица (строки локаций/работ/материалов) и строки ИТОГО/НДС. Формулы
// строятся по индексу строки — ExcelJS сам ссылки не сдвигает. Число строк подгоняется
// spliceRows, «хвост» уезжает блоком (merge сдвигаются корректно — проверено).
//
// Значения из БД: тип, наименование, ед.изм., объём, коэффициент. Цены (I/J) пустые —
// их заполняет подрядчик; стоимости (K,L,M,N) и подытоги — живые формулы. Название и адрес
// объекта из справочника «Проекты» подставляются в шапку (C5/C6).

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
  REF_SUBTOTAL_STYLE_ROW,
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

interface MergeRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

// Буквы столбца → номер (A→1, O→15).
function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Merge-диапазоны листа, начинающиеся со строки >= fromRow (для «хвоста»). Читаем внутреннюю
// модель ExcelJS (публичного перечисления merge нет), парсим A1-нотацию «A66:O66».
function collectMergesFrom(ws: ExcelJS.Worksheet, fromRow: number): MergeRect[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: string[] = ((ws as any).model?.merges ?? []) as string[];
  const rects: MergeRect[] = [];
  for (const ref of raw) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
    if (!m) continue;
    const top = Number(m[2]);
    if (top < fromRow) continue;
    rects.push({ top, left: colToNum(m[1]!), bottom: Number(m[4]), right: colToNum(m[3]!) });
  }
  return rects;
}

// Заполнить лист-справочник (МАТЕРИАЛЫ/РАБОТЫ) уникальными строками:
//   A=№, B=наименование, C=ед.изм.,
//   D=Объём — SUMIFS из «КП» по наименованию с фильтром по коду (Работа/Мат), чтобы работа и
//     материал с одинаковым именем не смешивались,
//   E=Цена — пусто (заполняет подрядчик),
//   F=ИТОГО — =E*D,
//   G=Примечание — пусто;
// после данных — строка-итог SUBTOTAL(9, F…) со стилем строки-образца.
// Не используем spliceRows (в шаблоне rowCount раздут, splice ведёт себя ненадёжно): стили
// (строки данных и строки-итога) снимаем ДО перезаписи, пишем строки поверх, лишние старые
// строки-образцы (наименования + старый итог) чистим по значению.
function fillReferenceSheet(
  ws: ExcelJS.Worksheet,
  dataStartRow: number,
  rows: ExportRefRow[],
  subtotalStyleRow: number,
  code: string,
): void {
  const maxCol = REF_COL.note;
  // Стили снимаем ДО записей: строку-итог могут перезаписать данные, если их много.
  const dataStyle = captureRowStyle(ws, dataStartRow, maxCol);
  const subtotalStyle = captureRowStyle(ws, subtotalStyleRow, maxCol);

  // Последняя существующая строка данных — сплошной блок наименований от dataStartRow;
  // старый итог (в нём наименование пусто) добавляем к границе очистки явно.
  let lastExisting = dataStartRow - 1;
  for (let r = dataStartRow; r < dataStartRow + 5000; r++) {
    const v = ws.getRow(r).getCell(REF_COL.name).value;
    if (v == null || String(v).trim() === '') break;
    lastExisting = r;
  }
  lastExisting = Math.max(lastExisting, subtotalStyleRow);

  const kpVol = colLetter(COL.volume); //  G — объём в «КП»
  const kpName = colLetter(COL.name); //   D — наименование в «КП»
  const kpCode = colLetter(COL.code); //   B — код (Работа/Мат) в «КП»
  const refName = colLetter(REF_COL.name); //   B — наименование в справочнике
  const refVol = colLetter(REF_COL.volume); //  D — объём
  const refPrice = colLetter(REF_COL.price); //  E — цена
  const refTotal = colLetter(REF_COL.total); //  F — итого

  rows.forEach((item, i) => {
    const rowNum = dataStartRow + i;
    const row = ws.getRow(rowNum);
    applyRowStyle(row, dataStyle, maxCol);
    row.getCell(REF_COL.num).value = i + 1;
    row.getCell(REF_COL.name).value = item.name;
    row.getCell(REF_COL.unit).value = item.unit ?? null;
    row.getCell(REF_COL.volume).value = {
      formula: `SUMIFS(КП!${kpVol}:${kpVol},КП!${kpName}:${kpName},${refName}${rowNum},КП!${kpCode}:${kpCode},"${code}")`,
    };
    row.getCell(REF_COL.price).value = null; // цену заполняет подрядчик
    row.getCell(REF_COL.total).value = { formula: `${refPrice}${rowNum}*${refVol}${rowNum}` };
    row.getCell(REF_COL.note).value = null;
  });

  // Строка-итог сразу за данными: заполнена только колонка F (=SUBTOTAL по стоимости).
  const subtotalRow = dataStartRow + rows.length;
  const sub = ws.getRow(subtotalRow);
  applyRowStyle(sub, subtotalStyle, maxCol);
  for (let c = 1; c <= maxCol; c++) sub.getCell(c).value = null;
  if (rows.length) {
    const first = dataStartRow;
    const last = dataStartRow + rows.length - 1;
    sub.getCell(REF_COL.total).value = { formula: `SUBTOTAL(9,${refTotal}${first}:${refTotal}${last})` };
  }

  // Очистить оставшиеся строки-образцы (значения) ниже строки-итога.
  for (let r = subtotalRow + 1; r <= lastExisting; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) row.getCell(c).value = null;
  }
}

const L = colLetter(COL.costMat); //  L
const M = colLetter(COL.costSmr); //  M
const N = colLetter(COL.costTotal); // N
const I = colLetter(COL.priceMat); //  I
const J = colLetter(COL.priceSmr); //  J
const G = colLetter(COL.volume); //   G — объём
const D = colLetter(COL.name); //     D — наименование (ключ поиска в МАТЕРИАЛЫ/РАБОТЫ)
const REF_NAME_COL = colLetter(REF_COL.name); //  B — наименование в справочнике
const REF_PRICE_COL = colLetter(REF_COL.price); // E — цена в справочнике

// XLOOKUP цены по наименованию (ячейка D{row}) в листе-справочнике sheet (МАТЕРИАЛЫ/РАБОТЫ):
// ищем в целом столбце наименований (B:B), возвращаем цену из столбца E:E. Аргументы 0,0,1 —
// «не найдено» = 0, точное совпадение, поиск сверху вниз. Префикс _xlfn. обязателен в XML.
function refLookup(sheet: string, row: number): string {
  const nameRange = `${sheet}!${REF_NAME_COL}:${REF_NAME_COL}`;
  const priceRange = `${sheet}!${REF_PRICE_COL}:${REF_PRICE_COL}`;
  return `_xlfn.XLOOKUP(${D}${row},${nameRange},${priceRange},0,0,1)`;
}

/** Собрать .xlsx (Buffer): заполнить лист «КП» блоками и листы-справочники МАТЕРИАЛЫ/РАБОТЫ. */
export async function exportKpWorkbook(
  blocks: ExportBlock[],
  refs: { materials: ExportRefRow[]; works: ExportRefRow[] },
  project: { name: string | null; address: string | null; ciphers?: string | null },
): Promise<Buffer> {
  const templateBuf = await readFile(resolveTemplatePath());
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(templateBuf as any);
  const ws = wb.getWorksheet(KP_SHEET);
  if (!ws) throw new Error(`В шаблоне нет листа «${KP_SHEET}»`);

  // Шапка формы: «Объект» (C5) и «Адрес объекта» (C6) — из справочника «Проекты»; «Шифр рабочей
  // документации» (C7) — список шифров РД видов работ, попавших в выгрузку. Ячейки в статичной
  // шапке (выше таблицы), splice их не двигает; C5:D5/C6:D6/C7:D7 объединены — пишем в
  // верхнюю-левую ячейку объединения.
  ws.getCell('C5').value = project.name ?? null;
  ws.getCell('C6').value = project.address ?? null;
  ws.getCell('C7').value = project.ciphers ?? null;

  // КП — активный лист по умолчанию (индекс 0). В шаблоне унаследован activeTab=2 (РАБОТЫ) —
  // переопределяем. activeTab (workbook) и tabSelected (пер-лист) в ExcelJS не синхронизированы,
  // поэтому вручную снимаем выделение со всех листов, кроме КП.
  wb.views = [{ x: 0, y: 0, width: 20000, height: 20000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  for (const sheet of wb.worksheets) {
    const v0 = (sheet.views && sheet.views[0]) || {};
    sheet.views = [{ ...v0, tabSelected: sheet.name === KP_SHEET } as unknown as ExcelJS.WorksheetView];
  }

  // Снимки стилей строк-образцов ДО сдвига строк (splice их подвинет/удалит).
  const style = {
    location: captureRowStyle(ws, STYLE_ROW.location),
    work: captureRowStyle(ws, STYLE_ROW.work),
    material: captureRowStyle(ws, STYLE_ROW.material),
    itogo: captureRowStyle(ws, STYLE_ROW.itogo),
    nds: captureRowStyle(ws, STYLE_ROW.nds),
  };
  // Столбец J (цена СМР) у строки-материала в исходной форме без ячейки → стиль без рамки.
  // Берём оформление соседней ценовой ячейки I (полная рамка, тот же fill/шрифт), чтобы у
  // материалов J имел рамку «как у соседей».
  style.material[COL.priceSmr] = JSON.parse(JSON.stringify(style.material[COL.priceMat]));

  // Сколько строк займёт динамическая зона: по каждому блоку строка-локация + её строки,
  // плюс ИТОГО и НДС.
  const detailRowsTotal = blocks.reduce((s, b) => s + b.rows.length, 0);
  const totalGen = blocks.length + detailRowsTotal + 2;

  // Подогнать число строк зоны под totalGen: хвост уедет вниз/вверх блоком.
  const delta = totalGen - DYN_TEMPLATE_ROWS;

  // Merge-диапазоны «хвоста» (условия на всю ширину A:O) снимаем ДО сдвига строк и ставим заново
  // со сдвигом на delta ПОСЛЕ. Иначе при УДАЛЕНИИ строк (delta<0) ExcelJS теряет эти merge и
  // размножает текст условий по всем колонкам; сняв их заранее, splice двигает только значения.
  const tailMerges = collectMergesFrom(ws, TAIL_START_ROW);
  for (const m of tailMerges) {
    try {
      ws.unMergeCells(m.top, m.left, m.bottom, m.right);
    } catch {
      /* merge мог отсутствовать — ок */
    }
  }

  if (delta > 0) {
    ws.spliceRows(TAIL_START_ROW, 0, ...Array.from({ length: delta }, () => []));
  } else if (delta < 0) {
    ws.spliceRows(TABLE_START_ROW + totalGen, -delta);
  }

  for (const m of tailMerges) {
    ws.mergeCells(m.top + delta, m.left, m.bottom + delta, m.right);
  }

  const setFormula = (row: ExcelJS.Row, col: number, formula: string) => {
    row.getCell(col).value = { formula };
  };

  let r = TABLE_START_ROW;
  for (const block of blocks) {
    const locRow = ws.getRow(r);
    applyRowStyle(locRow, style.location);
    locRow.outlineLevel = 0; // локация — верхний уровень группировки
    locRow.hidden = false;
    locRow.getCell(COL.name).value = block.locationLabel;
    const detailFirst = r + 1;
    const detailLast = r + block.rows.length;
    // Подытог локации: SUBTOTAL(9,…) по её строкам (материалы без стоимости не мешают).
    setFormula(locRow, COL.costMat, `SUBTOTAL(9,${L}${detailFirst}:${L}${detailLast})`);
    setFormula(locRow, COL.costSmr, `SUBTOTAL(9,${M}${detailFirst}:${M}${detailLast})`);
    setFormula(locRow, COL.costTotal, `SUBTOTAL(9,${N}${detailFirst}:${N}${detailLast})`);
    r += 1;

    // Текущая работа и диапазон её материалов (материалы идут подряд сразу за работой) —
    // для формулы цены материалов работы (SUMPRODUCT). Флашим в конце и при новой работе.
    let workRow = 0;
    let matFirst = 0;
    let matLast = 0;
    const flushWorkMat = () => {
      if (workRow && matFirst) {
        // Цена материалов работы = Σ(объём·цена материала) / объём работы.
        setFormula(
          ws.getRow(workRow),
          COL.priceMat,
          `IFERROR(SUMPRODUCT(${G}${matFirst}:${G}${matLast},${I}${matFirst}:${I}${matLast})/${G}${workRow},0)`,
        );
      }
    };

    for (const item of block.rows) {
      const row = ws.getRow(r);
      const isWork = item.kind === 'work';
      applyRowStyle(row, isWork ? style.work : style.material);
      row.outlineLevel = isWork ? 1 : 2; // работа — 1, материал — 2
      row.hidden = false;
      row.getCell(COL.num).value = item.number;
      row.getCell(COL.code).value = isWork ? CODE_WORK : CODE_MATERIAL;
      row.getCell(COL.type).value = item.typeName ?? null;
      row.getCell(COL.name).value = item.name;
      row.getCell(COL.unit).value = item.unit ?? null;
      row.getCell(COL.volume).value = item.volume ?? null;
      if (isWork) {
        flushWorkMat(); // завершить предыдущую работу
        workRow = r;
        matFirst = 0;
        matLast = 0;
        // Цена СМР (J) — XLOOKUP из «РАБОТЫ» по наименованию; цена материалов (I) — SUMPRODUCT
        // (позже); цена-итого и стоимости — живые формулы.
        if (refs.works.length) setFormula(row, COL.priceSmr, refLookup(BSR_SHEET, r));
        setFormula(row, COL.priceTotal, `SUM(${I}${r}:${J}${r})`);
        setFormula(row, COL.costMat, `${I}${r}*${G}${r}`);
        setFormula(row, COL.costSmr, `${J}${r}*${G}${r}`);
        setFormula(row, COL.costTotal, `SUM(${L}${r}:${M}${r})`);
        // Примечания работы → столбец «Примечание» (O). Несколько — в одной ячейке с переносами.
        if (item.notes) {
          const noteCell = row.getCell(COL.note);
          noteCell.value = item.notes;
          // Мерджим поверх стиля образца — не затираем рамку/шрифт шаблона.
          noteCell.alignment = { ...noteCell.alignment, wrapText: true, vertical: 'top' };
          const lineCount = item.notes.split('\n').length;
          if (lineCount > 1) row.height = Math.max(row.height ?? 15, 15 * lineCount);
        }
      } else {
        row.getCell(COL.coef).value = item.coef ?? null;
        // Цена материала (I) — XLOOKUP из «МАТЕРИАЛЫ» по наименованию; J у материала пусто.
        if (refs.materials.length) setFormula(row, COL.priceMat, refLookup(BSM_SHEET, r));
        if (!matFirst) matFirst = r;
        matLast = r;
      }
      r += 1;
    }
    flushWorkMat(); // завершить последнюю работу блока
  }

  // ИТОГО и «в т.ч. НДС».
  const tableLast = r - 1;
  const itogoRow = ws.getRow(r);
  applyRowStyle(itogoRow, style.itogo);
  itogoRow.outlineLevel = 0;
  itogoRow.hidden = false;
  itogoRow.getCell(COL.name).value = ITOGO_LABEL;
  setFormula(itogoRow, COL.costMat, `SUBTOTAL(9,${L}${TABLE_START_ROW}:${L}${tableLast})`);
  setFormula(itogoRow, COL.costSmr, `SUBTOTAL(9,${M}${TABLE_START_ROW}:${M}${tableLast})`);
  setFormula(itogoRow, COL.costTotal, `SUBTOTAL(9,${N}${TABLE_START_ROW}:${N}${tableLast})`);
  const itogoRowNum = r;
  r += 1;

  const ndsRow = ws.getRow(r);
  applyRowStyle(ndsRow, style.nds);
  ndsRow.outlineLevel = 0;
  ndsRow.hidden = false;
  ndsRow.getCell(COL.name).value = NDS_LABEL;
  setFormula(ndsRow, COL.costMat, `${L}${itogoRowNum}/122*22`);
  setFormula(ndsRow, COL.costSmr, `${M}${itogoRowNum}/122*22`);
  setFormula(ndsRow, COL.costTotal, `${N}${itogoRowNum}/122*22`);

  // Группировка: локация (0) → работа (1) → материал (2), итог группы — сверху (summaryBelow=0).
  ws.properties.outlineLevelRow = 2;
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  // Листы-справочники МАТЕРИАЛЫ и РАБОТЫ — уникальные наименования с ед.изм., объёмом (SUMIFS
  // из «КП») и строкой-итогом; код (Мат/Работа) фильтрует SUMIFS, цену вносит подрядчик.
  const bsm = wb.getWorksheet(BSM_SHEET);
  if (bsm) fillReferenceSheet(bsm, REF_DATA_START_ROW, refs.materials, REF_SUBTOTAL_STYLE_ROW.materials, CODE_MATERIAL);
  const bsr = wb.getWorksheet(BSR_SHEET);
  if (bsr) fillReferenceSheet(bsr, REF_DATA_START_ROW, refs.works, REF_SUBTOTAL_STYLE_ROW.works, CODE_WORK);

  const out = await wb.xlsx.writeBuffer();
  return sanitizeXlsx(Buffer.from(out as ArrayBuffer));
}
