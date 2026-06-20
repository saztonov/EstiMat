/**
 * Классификация таблиц РД и определение ролей колонок.
 *
 * Цель — без LLM понять: это извлекаемая спецификация (есть наименование и
 * количество) → извлекаем rule-based; служебная таблица (ведомость чертежей,
 * лист изменений) → пропускаем; неоднозначная → отдаём LLM.
 */
import type { ExtractRules } from './types.js';
import { norm } from './normalize.js';

export type TableKind = 'spec' | 'skip' | 'ambiguous';

export type ColumnRole = 'name' | 'quantity' | 'unit' | 'mark' | 'gost' | 'mass' | 'note';

export interface ColumnMap {
  name: number | null;
  quantity: number | null;
  unit: number | null;
  mark: number | null;
  gost: number | null;
}

export interface TableClassification {
  kind: TableKind;
  columns: ColumnMap;
  /** Можно ли извлекать rule-based (есть наименование + количество). */
  confident: boolean;
  reason: string;
}

// Словарь синонимов заголовков колонок → роль. Подстроки нормализованного заголовка.
// Словарь синонимов заголовков колонок → роль. Базовые значения вшиты в код
// (применяются всегда, и в сервере, и в CLI, без rules.json).
const DEFAULT_COLUMN_ALIASES: Record<ColumnRole, string[]> = {
  name: [
    'наименование',
    'наименование и техническая характеристика',
    'наименование и характеристика',
    'тип, марка',
    'тип,марка',
    'тип и обозначение',
    'материал',
    'обозначение',
    'элемент',
  ],
  quantity: ['кол-во', 'колво', 'кол.', 'кол ', 'количество', 'колич', 'к-во', 'всего, шт', 'всего,шт', 'всего шт', 'общее кол'],
  unit: ['ед.изм', 'ед. изм', 'единиц', 'ед изм', 'ед.', 'ед '],
  mark: ['поз.', 'поз ', 'позиц', 'маркировка', 'марка'],
  gost: ['гост', ' ту', 'обозначение документа', 'код', 'артикул'],
  mass: ['масса', 'вес'],
  note: ['примечание', 'примеч'],
};

// Признаки служебных/не-спецификационных таблиц (по заголовкам) — такие пропускаем.
const SKIP_HEADER_HINTS = [
  'формат',
  'наименование документа',
  'наименование чертежа',
  'лист',
  'изм.',
  'кол.уч',
  'подп.',
  // экспликации помещений / маркировочные планы / ведомости отделки — не материалы:
  '№ пом',
  'номер помещения',
  'наименование помещения',
  'площадь',
  'кат. пом',
  'кат.пом',
  'категория помещен',
  'экспликац',
  'маркировочный план',
  'ведомость отделки',
  'вид отделки',
];

function matchRole(
  header: string,
  role: ColumnRole,
  extraAliases: Record<string, string[]>,
): boolean {
  const h = norm(header);
  const aliases = [
    ...(DEFAULT_COLUMN_ALIASES[role] ?? []),
    ...(extraAliases[role] ?? []),
  ];
  return aliases.some((a) => h.includes(norm(a)));
}

/** Роли, по которым опознаём «настоящую» строку заголовков. */
const SCAN_ROLES: ColumnRole[] = ['name', 'quantity', 'unit', 'mark', 'gost'];

/** Сколько ячеек строки совпали с известными ролями колонок. */
function headerRoleScore(cells: string[], extraAliases: Record<string, string[]>): number {
  let score = 0;
  for (const c of cells) {
    if (SCAN_ROLES.some((role) => matchRole(c, role, extraAliases))) score++;
  }
  return score;
}

/** Строка нумерации колонок («1 | 2 | 3 | …») — служебная, не данные. */
function isNumberingRow(cells: string[]): boolean {
  const filled = cells.filter((c) => c.trim() !== '');
  if (filled.length < 2) return false;
  return filled.every((c) => /^\d{1,2}$/.test(c.trim()));
}

/**
 * Нормализация шапки спец-таблицы РД: в распознанных таблицах настоящая шапка
 * часто НЕ в первой строке (сверху пустая строка `| | | |`), а сразу под шапкой
 * идёт строка нумерации колонок «1 2 3 …». Находим реальную шапку среди первых
 * строк (по совпадению ячеек с ролями) и отбрасываем строку нумерации.
 */
export function normalizeTableHeader(
  headers: string[],
  rows: string[][],
  rules: ExtractRules = {},
): { headers: string[]; rows: string[][] } {
  const extraAliases = rules.columnAliases ?? {};
  const nonEmptyHeader = headers.filter((h) => h.trim() !== '').length;

  // Шапка вырождена (пустая/без ролей) → ищем настоящую среди первых строк.
  if (headerRoleScore(headers, extraAliases) < 2 || nonEmptyHeader < 2) {
    const limit = Math.min(rows.length, 4);
    for (let r = 0; r < limit; r++) {
      const candidate = rows[r];
      if (candidate && headerRoleScore(candidate, extraAliases) >= 2) {
        let dataRows = rows.slice(r + 1);
        if (dataRows.length && isNumberingRow(dataRows[0]!)) dataRows = dataRows.slice(1);
        return { headers: candidate, rows: dataRows };
      }
    }
  }

  // Шапка в первой строке — отбросить возможную строку нумерации в начале данных.
  let dataRows = rows;
  if (dataRows.length && isNumberingRow(dataRows[0]!)) dataRows = dataRows.slice(1);
  return { headers, rows: dataRows };
}

export function classifyTable(
  headers: string[],
  rows: string[][],
  rules: ExtractRules = {},
): TableClassification {
  const extraAliases = rules.columnAliases ?? {};
  const columns: ColumnMap = { name: null, quantity: null, unit: null, mark: null, gost: null };

  // Приоритет наименования: явный столбец «наименование» важнее «обозначения»/«марки»
  // (в спецификациях заполнения проёмов рядом стоят «Обозначение» (ГОСТ) и «Наименование»).
  const explicitName = headers.findIndex((h) => norm(h).includes('наименование'));
  if (explicitName >= 0) columns.name = explicitName;

  headers.forEach((h, idx) => {
    // Назначаем первую подходящую роль, не перезаписывая уже найденную.
    if (columns.name === null && matchRole(h, 'name', extraAliases)) columns.name = idx;
    else if (columns.quantity === null && matchRole(h, 'quantity', extraAliases)) columns.quantity = idx;
    else if (columns.unit === null && matchRole(h, 'unit', extraAliases)) columns.unit = idx;
    else if (columns.mark === null && matchRole(h, 'mark', extraAliases)) columns.mark = idx;
    else if (columns.gost === null && matchRole(h, 'gost', extraAliases)) columns.gost = idx;
  });

  const headerBlob = norm(headers.join(' | '));
  const isSkip = SKIP_HEADER_HINTS.some((h) => headerBlob.includes(norm(h)));

  if (isSkip && columns.quantity === null) {
    return { kind: 'skip', columns, confident: false, reason: 'служебная таблица (по заголовкам)' };
  }

  if (rows.length === 0) {
    return { kind: 'skip', columns, confident: false, reason: 'пустая таблица' };
  }

  // Уверенное rule-based извлечение: есть наименование И количество.
  if (columns.name !== null && columns.quantity !== null) {
    return { kind: 'spec', columns, confident: true, reason: 'есть наименование и количество' };
  }

  // Есть наименование и спец-признак (ед.изм/маркировка), но кол-во не распознано —
  // возможно слитые ячейки / нестандартная шапка → консервативно на LLM.
  if (columns.name !== null && (columns.unit !== null || columns.mark !== null)) {
    return { kind: 'ambiguous', columns, confident: false, reason: 'спец-таблица без явного количества' };
  }

  // Только наименование (+примечание/обозначение) без кол-ва/ед./марки — это НЕ спецификация
  // материалов (ведомости комплектов/ссылок, экспликации). Не отдаём в LLM.
  if (columns.name !== null) {
    return { kind: 'skip', columns, confident: false, reason: 'не спецификация материалов (только наименование)' };
  }

  return { kind: 'skip', columns, confident: false, reason: 'не распознана колонка наименования' };
}
