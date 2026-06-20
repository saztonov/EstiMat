/**
 * Rule-based извлечение позиций из классифицированной спец-таблицы (0 токенов).
 * Каждая строка таблицы → RawSpecItem. Количество парсится из русских чисел.
 */
import type { RawSpecItem, ExtractRules, SpecKind } from './types.js';
import type { ColumnMap } from './table-classifier.js';
import { norm, normUnit, parseRuNumber } from './normalize.js';

// Признаки оборудования (а не расходного материала).
const EQUIPMENT_HINTS = [
  'насос',
  'агрегат',
  'щит',
  'шкаф',
  'установка',
  'прибор',
  'автомат',
  'выключатель',
  'светильник',
  'двигатель',
  'вентилятор',
  'котёл',
  'котел',
  'станция',
  'преобразователь',
  'квт',
  'ква',
];

// Строки, которые не являются позициями (итоги, заголовки разделов).
const SKIP_ROW_HINTS = ['итого', 'всего', 'примечание', 'продолжение'];

/**
 * Сметчицкий фильтр шума: наименование — это маркировочный код/ось/секция/зона
 * или единица «этаж». Применяется и к rule-based, и к LLM-извлечённым позициям.
 */
export function isNoiseSpecName(name: string, unit: string | null): boolean {
  const n = norm(name);
  if (!n) return true;
  const u = norm(unit ?? '').replace(/\.$/, '');
  if (u === 'эт' || u === 'этаж' || u === 'этажей') return true; // этажность — не материал
  if (/^\d+\s*эт\.?$/.test(n)) return true; // «48эт.»
  if (/^[a-zа-я]{1,3}\W?\d+[а-я.\-]*$/.test(n) && n.length <= 6) return true; // К1, П.1, В1ас
  if (/^п\.?\d/.test(n)) return true; // П.1-П.24, П.48
  if (/^\d+\s*\.?\s*[а-я]$/.test(n)) return true; // оси 6.а, 3.л, 4.и
  if (n === 'лобби') return true;
  if (n.startsWith('подземная автостоянка')) return true;
  if (n.startsWith('пристройка')) return true;
  // Служебные артефакты RDLOCAL/чертежа, если просочились через LLM как «позиция».
  if (/^block\s*\[/.test(n)) return true;
  if (n.startsWith('страница')) return true;
  if (n.startsWith('общие указания')) return true;
  if (n.startsWith('сущности')) return true;
  if (n.startsWith('краткое описание')) return true;
  return false;
}

function classifyKind(name: string): SpecKind {
  const n = norm(name);
  if (EQUIPMENT_HINTS.some((h) => n.includes(h))) return 'equipment';
  return 'material';
}

function cell(row: string[], idx: number | null): string {
  if (idx === null || idx < 0 || idx >= row.length) return '';
  return (row[idx] ?? '').trim();
}

/** Вытащить ГОСТ/ТУ из наименования, если отдельной колонки нет. */
function extractGost(name: string): string | null {
  const m = name.match(/(ГОСТ|ТУ|СНиП|СП)\s*[\d.\- ]+[\d]/i);
  return m ? m[0].trim() : null;
}

export function extractSpecTable(
  headers: string[],
  rows: string[][],
  columns: ColumnMap,
  sectionPath: string[],
  rules: ExtractRules = {},
): { items: RawSpecItem[]; anomalies: string[] } {
  const items: RawSpecItem[] = [];
  const anomalies: string[] = [];
  const unitAliases = rules.unitAliases ?? {};

  for (const row of rows) {
    const rawName = cell(row, columns.name);
    if (!rawName) {
      // Строка без наименования, но с количеством — вероятно подпозиция/типоразмер
      // под предыдущим наименованием (например, сечения кабеля). Не теряем молча.
      const qtyOrphan = cell(row, columns.quantity);
      if (qtyOrphan && parseRuNumber(qtyOrphan) !== null) {
        anomalies.push(`Строка без наименования с количеством (подпозиция?): ${row.join(' | ')}`);
      }
      continue;
    }

    const nameNorm = norm(rawName);
    if (SKIP_ROW_HINTS.some((h) => nameNorm.startsWith(h))) continue;
    // Строка-подзаголовок: заполнено только наименование, нет ни кол-ва, ни позиции.
    const qtyRaw = cell(row, columns.quantity);
    const markRaw = cell(row, columns.mark);
    if (!qtyRaw && !markRaw && row.filter((c) => c.trim()).length === 1) {
      // Вероятно подзаголовок группы внутри таблицы — не позиция.
      continue;
    }

    const quantity = parseRuNumber(qtyRaw);
    const unit = normUnit(cell(row, columns.unit) || null, unitAliases);
    // Сметчицкий фильтр: маркировочные коды/оси/секции/этажность — не материалы.
    if (isNoiseSpecName(rawName, unit)) continue;
    const gost = cell(row, columns.gost) || extractGost(rawName);
    const mark = markRaw || null;

    if (quantity === null && qtyRaw) {
      anomalies.push(`Не распознано количество «${qtyRaw}» в строке: ${rawName}`);
    }

    items.push({
      rawName,
      construction: sectionPath[sectionPath.length - 1] ?? null,
      quantity,
      unit,
      mark,
      gost: gost || null,
      sourceSnippet: row.join(' | '),
      kind: classifyKind(rawName),
      confidence: quantity !== null ? 0.9 : 0.6,
      sectionPath,
    });
  }

  return { items, anomalies };
}
