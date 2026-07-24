/**
 * Единое локализованное представление чисел (русская локаль): разделитель тысяч — неразрывный
 * пробел, десятичный — запятая. В БД и по сети числа идут БЕЗ разделителей — форматирование
 * живёт только на уровне отображения.
 */

/** Неразрывный пробел (U+00A0) — разделитель тысяч (не переносится и не ломает вёрстку). */
const GROUP = String.fromCharCode(0x00a0);
/** Все виды пробелов (обычный, NBSP, узкий NBSP) — снимаются при разборе ввода. */
const SPACES = new RegExp(`[\\s${String.fromCharCode(0x00a0)}${String.fromCharCode(0x202f)}]`, 'g');

/** number/строка «1234.5» → «1 234,5» для показа. Пустые/невалидные → ''. */
export function formatRu(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const s = typeof value === 'number' ? String(value) : value;
  if (!/^-?\d*\.?\d*$/.test(s)) return s; // не число — отдаём как есть (не портим промежуточный ввод)
  const neg = s.startsWith('-');
  const abs = neg ? s.slice(1) : s;
  const [int, frac] = abs.split('.');
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  const body = frac !== undefined ? `${grouped},${frac}` : grouped;
  return neg ? `-${body}` : body;
}

/** Ввод «1 234,5» / «1234.5» → «1234.5». Пробелы убираются, запятая → точка. */
export function parseRu(display: string | undefined): string {
  if (!display) return '';
  return display.replace(SPACES, '').replace(',', '.');
}

/** Готовое к показу форматирование денежной суммы (2 знака): «1 234 567,89» без символа валюты. */
export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  return formatRu(n.toFixed(2));
}
