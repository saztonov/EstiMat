// Чтение договорных цен из заполненного подрядчиком ВОР и привязка их к строкам сметы.
//
// Где лежат цены. В выгруженной книге ячейки цен листа «КП» — НАШИ формулы (XLOOKUP из
// «РАБОТЫ»/«МАТЕРИАЛЫ», SUMPRODUCT по материалам работы), а вводит подрядчик колонку E
// листов-справочников. ExcelJS формулы не вычисляет, и кэш результата в файле может быть
// устаревшим или отсутствовать вовсе — поэтому источник истины здесь справочники, а «КП»
// учитывается лишь там, где формулу заменили числом вручную (такое переопределение сильнее).
//
// Как строка файла находит строку сметы. В новых выгрузках есть служебный лист-якорь с id ВОР и
// парами «строка «КП» → UUID работы/материала» — сопоставление точное и переживает сортировку,
// вставку и удаление строк подрядчиком. У ВОР, выгруженных до появления якоря, сопоставление
// позиционное (N-я работа файла ↔ N-я работа снимка) с обязательной сверкой номера, наименования
// и единицы: разошлось — строку не берём, чужую цену записывать нельзя.

import ExcelJS from 'exceljs';
import {
  ANCHOR_COL,
  ANCHOR_DATA_START_ROW,
  ANCHOR_MARKER,
  ANCHOR_SHEET,
  CODE_MATERIAL,
  CODE_WORK,
  COL,
  KP_SHEET,
  BSM_SHEET,
  BSR_SHEET,
  REF_COL,
  REF_DATA_START_ROW,
} from '../estimate-export/layout.js';
import type { VorItemSnapshot, VorManifest } from '../estimate-export/vor-content.js';

/** Ошибка разбора книги: наружу превращается в 400 с этим текстом. */
export class VorPriceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VorPriceParseError';
  }
}

/** Строка листа «КП» из присланного файла. */
export interface ParsedKpRow {
  kind: 'work' | 'material';
  /** № п/п из колонки A («12», «12.3») — им сверяется позиционное сопоставление. */
  number: string | null;
  name: string;
  unit: string | null;
  /** Цена, введённая прямо в «КП» константой (формула источником не считается). */
  overridePrice: number | null;
  /** В ячейке цены текст, который не разобрать как число. */
  overrideInvalid: boolean;
  /** Привязка из служебного листа (если он есть). */
  itemId: string | null;
  materialId: string | null;
}

export interface ParsedVorWorkbook {
  /** id ВОР из служебного листа; null — файл выгружен до появления якоря. */
  vorId: string | null;
  hasAnchors: boolean;
  rows: ParsedKpRow[];
  /** Нормализованное наименование → цена из колонки E листа-справочника. */
  workPrices: Map<string, number>;
  materialPrices: Map<string, number>;
  /** Наименования, у которых в справочнике стоит неразбираемый текст вместо цены. */
  invalidRefNames: Set<string>;
}

/** Наименование как ключ сопоставления: регистр, ё/е и лишние пробелы не должны мешать. */
export function normalizeName(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е');
}

/** Единица измерения как ключ сверки: «м2»/«М2 » — одно и то же. */
function normalizeUnit(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

type PriceRead = { price: number | null; invalid: boolean };

/**
 * Число из ячейки: сама числовая ячейка, результат формулы (только если allowFormula) либо
 * строка вида «1 234,56». Явный ноль — валидная цена. Пустая ячейка — не ошибка, просто нет цены.
 */
export function readPriceCell(value: ExcelJS.CellValue, allowFormula: boolean): PriceRead {
  if (value === null || value === undefined) return { price: null, invalid: false };
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'object') {
    const rec = value as { result?: unknown; formula?: unknown; richText?: { text: string }[]; text?: unknown };
    if (rec.formula !== undefined) {
      // Формула из нашего шаблона ценой не считается: её результат — кэш, который мог устареть.
      if (!allowFormula) return { price: null, invalid: false };
      return typeof rec.result === 'number' ? finite(rec.result) : { price: null, invalid: false };
    }
    if (Array.isArray(rec.richText)) return readPriceCell(rec.richText.map((t) => t.text).join(''), allowFormula);
    if (typeof rec.text === 'string') return readPriceCell(rec.text, allowFormula);
    return { price: null, invalid: true };
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return { price: null, invalid: false };
    // Пробелы-разделители разрядов (включая неразрывные), запятая как десятичный разделитель.
    const cleaned = raw.replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { price: null, invalid: true };
    return finite(Number(cleaned));
  }
  return { price: null, invalid: true };
}

function finite(n: number): PriceRead {
  if (!Number.isFinite(n) || n < 0) return { price: null, invalid: true };
  return { price: n, invalid: false };
}

/** Цены из листа-справочника: наименование (B) → цена (E). Пустые строки пропускаем. */
function readReferenceSheet(
  ws: ExcelJS.Worksheet | undefined,
  invalidNames: Set<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!ws) return out;
  for (let r = REF_DATA_START_ROW; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = normalizeName(String(row.getCell(REF_COL.name).value ?? ''));
    if (!name) continue;
    // Подрядчик мог посчитать цену формулой прямо в справочнике — это его значение, принимаем.
    const { price, invalid } = readPriceCell(row.getCell(REF_COL.price).value, true);
    if (invalid) invalidNames.add(name);
    if (price !== null) out.set(name, price);
  }
  return out;
}

/** Разобрать книгу заполненного ВОР. Бросает VorPriceParseError, если это не наш файл. */
export function parseFilledVorWorkbook(wb: ExcelJS.Workbook): ParsedVorWorkbook {
  const kp = wb.getWorksheet(KP_SHEET);
  if (!kp) throw new VorPriceParseError(`В файле нет листа «${KP_SHEET}» — это не выгрузка ВОР`);

  // Служебный лист: id ВОР и привязка строк «КП» к строкам сметы.
  let vorId: string | null = null;
  const itemIdByRow = new Map<number, { itemId: string; materialId: string | null }>();
  const anchor = wb.getWorksheet(ANCHOR_SHEET);
  if (anchor && String(anchor.getCell(1, 1).value ?? '') === ANCHOR_MARKER) {
    vorId = String(anchor.getCell(2, 1).value ?? '').trim() || null;
    for (let r = ANCHOR_DATA_START_ROW; r <= anchor.rowCount; r++) {
      const row = anchor.getRow(r);
      const kpRow = Number(row.getCell(ANCHOR_COL.row).value ?? 0);
      const itemId = String(row.getCell(ANCHOR_COL.itemId).value ?? '').trim();
      if (!kpRow || !itemId) continue;
      const materialId = String(row.getCell(ANCHOR_COL.materialId).value ?? '').trim();
      itemIdByRow.set(kpRow, { itemId, materialId: materialId || null });
    }
  }

  const rows: ParsedKpRow[] = [];
  for (let r = 1; r <= kp.rowCount; r++) {
    const row = kp.getRow(r);
    const code = String(row.getCell(COL.code).value ?? '').trim();
    if (code !== CODE_WORK && code !== CODE_MATERIAL) continue; // строка-локация, шапка, ИТОГО
    const kind = code === CODE_WORK ? 'work' : 'material';
    // Цена работы — колонка «СМР» (J), цена материала — «Материалы» (I): так их писал экспорт.
    const priceCell = row.getCell(kind === 'work' ? COL.priceSmr : COL.priceMat).value;
    const { price, invalid } = readPriceCell(priceCell, false);
    const anchorRef = itemIdByRow.get(r);
    rows.push({
      kind,
      number: String(row.getCell(COL.num).value ?? '').trim() || null,
      name: String(row.getCell(COL.name).value ?? '').trim(),
      unit: String(row.getCell(COL.unit).value ?? '').trim() || null,
      overridePrice: price,
      overrideInvalid: invalid,
      itemId: anchorRef?.itemId ?? null,
      materialId: anchorRef?.materialId ?? null,
    });
  }

  const invalidRefNames = new Set<string>();
  return {
    vorId,
    hasAnchors: itemIdByRow.size > 0,
    rows,
    workPrices: readReferenceSheet(wb.getWorksheet(BSR_SHEET), invalidRefNames),
    materialPrices: readReferenceSheet(wb.getWorksheet(BSM_SHEET), invalidRefNames),
    invalidRefNames,
  };
}

/** Загрузить книгу из буфера (обёртка над ExcelJS, чтобы разбор оставался тестируемым). */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
  } catch {
    throw new VorPriceParseError('Файл не читается как .xlsx');
  }
  return wb;
}

export type PriceIssueReason = 'no_price' | 'bad_price' | 'not_matched' | 'changed';

export interface MatchedPrice {
  itemId: string;
  /** Для материала — его id в смете; у работы null. */
  materialId: string | null;
  number: string | null;
  name: string;
  price: number | null;
  reason?: PriceIssueReason;
}

export interface VorPriceMatch {
  works: MatchedPrice[];
  materials: MatchedPrice[];
  /** Строки файла, которые не удалось привязать к смете. */
  unmatched: MatchedPrice[];
  matchedBy: 'anchor' | 'position';
}

/** Цена строки: приоритет у введённой прямо в «КП» константы, затем — справочник по наименованию. */
function resolvePrice(row: ParsedKpRow, parsed: ParsedVorWorkbook): PriceRead {
  if (row.overridePrice !== null) return { price: row.overridePrice, invalid: false };
  if (row.overrideInvalid) return { price: null, invalid: true };
  const key = normalizeName(row.name);
  const table = row.kind === 'work' ? parsed.workPrices : parsed.materialPrices;
  const price = table.get(key);
  if (price !== undefined) return { price, invalid: false };
  return { price: null, invalid: parsed.invalidRefNames.has(key) };
}

function toMatched(
  row: ParsedKpRow,
  itemId: string,
  materialId: string | null,
  parsed: ParsedVorWorkbook,
): MatchedPrice {
  const { price, invalid } = resolvePrice(row, parsed);
  return {
    itemId,
    materialId,
    number: row.number,
    name: row.name,
    price,
    reason: invalid ? 'bad_price' : price === null ? 'no_price' : undefined,
  };
}

const unmatched = (row: ParsedKpRow, reason: PriceIssueReason): MatchedPrice => ({
  itemId: '',
  materialId: null,
  number: row.number,
  name: row.name,
  price: null,
  reason,
});

/** Совпадает ли строка файла со снимком: наименование и единица (номер сверяется отдельно). */
function sameContent(row: ParsedKpRow, name: string, unit: string | null): boolean {
  if (normalizeName(row.name) !== normalizeName(name)) return false;
  // Единицу сверяем, только если она есть в обоих местах: подрядчик мог очистить колонку.
  if (row.unit && unit && normalizeUnit(row.unit) !== normalizeUnit(unit)) return false;
  return true;
}

/** Сопоставление по служебному листу: строка знает свои UUID, порядок значения не имеет. */
function matchByAnchor(parsed: ParsedVorWorkbook, manifest: VorManifest): VorPriceMatch {
  const itemById = new Map(manifest.items.map((it) => [it.itemId, it]));
  const materialIds = new Set<string>();
  for (const it of manifest.items) for (const m of it.materials) materialIds.add(m.materialId);

  const works: MatchedPrice[] = [];
  const materials: MatchedPrice[] = [];
  const rest: MatchedPrice[] = [];
  for (const row of parsed.rows) {
    if (!row.itemId || !itemById.has(row.itemId)) {
      rest.push(unmatched(row, 'not_matched'));
      continue;
    }
    if (row.kind === 'work') {
      works.push(toMatched(row, row.itemId, null, parsed));
    } else if (row.materialId && materialIds.has(row.materialId)) {
      materials.push(toMatched(row, row.itemId, row.materialId, parsed));
    } else {
      rest.push(unmatched(row, 'not_matched'));
    }
  }
  return { works, materials, unmatched: rest, matchedBy: 'anchor' };
}

/** Сопоставление по порядку — для ВОР, выгруженных до появления служебного листа. */
function matchByPosition(parsed: ParsedVorWorkbook, manifest: VorManifest): VorPriceMatch {
  const works: MatchedPrice[] = [];
  const materials: MatchedPrice[] = [];
  const rest: MatchedPrice[] = [];

  let workIndex = -1;
  let materialIndex = 0;
  let currentItem: VorItemSnapshot | undefined;
  let workBroken = false; // сопоставление работы не сошлось — её материалы тоже не берём

  for (const row of parsed.rows) {
    if (row.kind === 'work') {
      workIndex += 1;
      materialIndex = 0;
      currentItem = manifest.items[workIndex];
      workBroken = false;
      if (!currentItem) {
        workBroken = true;
        rest.push(unmatched(row, 'not_matched'));
        continue;
      }
      const numberOk = !row.number || row.number === String(workIndex + 1);
      if (!numberOk || !sameContent(row, currentItem.name, currentItem.unit)) {
        workBroken = true;
        rest.push(unmatched(row, 'changed'));
        continue;
      }
      works.push(toMatched(row, currentItem.itemId, null, parsed));
      continue;
    }

    const snapMaterial = currentItem?.materials[materialIndex];
    materialIndex += 1;
    if (workBroken || !currentItem || !snapMaterial) {
      rest.push(unmatched(row, workBroken ? 'changed' : 'not_matched'));
      continue;
    }
    if (!sameContent(row, snapMaterial.name, snapMaterial.unit)) {
      rest.push(unmatched(row, 'changed'));
      continue;
    }
    materials.push(toMatched(row, currentItem.itemId, snapMaterial.materialId, parsed));
  }
  return { works, materials, unmatched: rest, matchedBy: 'position' };
}

/**
 * Привязать цены из файла к строкам сметы. Точный путь — служебный лист-якорь; если его нет
 * (старая выгрузка), сопоставляем по порядку со сверкой номера, наименования и единицы.
 */
export function matchVorPrices(parsed: ParsedVorWorkbook, manifest: VorManifest): VorPriceMatch {
  return parsed.hasAnchors ? matchByAnchor(parsed, manifest) : matchByPosition(parsed, manifest);
}
