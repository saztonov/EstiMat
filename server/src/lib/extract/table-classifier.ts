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
const DEFAULT_COLUMN_ALIASES: Record<ColumnRole, string[]> = {
  name: [
    'наименование',
    'тип, марка',
    'тип,марка',
    'тип и обозначение',
    'материал',
    'обозначение',
    'элемент',
  ],
  quantity: ['кол-во', 'колво', 'кол.', 'кол ', 'количество', 'колич', 'к-во'],
  unit: ['ед.изм', 'ед. изм', 'единиц', 'ед изм', 'ед.', 'ед '],
  mark: ['поз.', 'поз ', 'позиц', 'маркировка', 'марка'],
  gost: ['гост', ' ту', 'обозначение документа', 'код', 'артикул'],
  mass: ['масса', 'вес'],
  note: ['примечание', 'примеч'],
};

// Признаки служебных таблиц (по заголовкам колонок) — такие пропускаем.
const SKIP_HEADER_HINTS = [
  'формат',
  'наименование документа',
  'наименование чертежа',
  'лист',
  'изм.',
  'кол.уч',
  'подп.',
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

export function classifyTable(
  headers: string[],
  rows: string[][],
  rules: ExtractRules = {},
): TableClassification {
  const extraAliases = rules.columnAliases ?? {};
  const columns: ColumnMap = { name: null, quantity: null, unit: null, mark: null, gost: null };

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

  // Есть наименование, но количество не распознано колонкой — возможно слитые
  // ячейки / нестандартная шапка → на LLM.
  if (columns.name !== null) {
    return { kind: 'ambiguous', columns, confident: false, reason: 'нет колонки количества' };
  }

  return { kind: 'ambiguous', columns, confident: false, reason: 'не распознана колонка наименования' };
}
