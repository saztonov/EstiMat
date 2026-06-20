/**
 * Нормализация и нечёткое сравнение строк для сопоставления со справочником.
 *
 * `norm` намеренно совпадает с нормализацией в db/import-vor-catalog.ts
 * (lowercase, ё→е, схлопывание пробелов) — так алиасы, положенные в
 * rates_v2.aliases конвейером vor-catalog, матчатся консистентно.
 */

/** Базовая нормализация наименования. */
export const norm = (s: string): string =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Более агрессивная нормализация для нечёткого сравнения: убирает пунктуацию
 * и единичные неинформативные символы, оставляет буквы/цифры/пробелы.
 */
export const normLoose = (s: string): string =>
  norm(s)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Множество триграмм строки (для коэффициента Дайса). */
function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

/**
 * Триграммная схожесть (коэффициент Сёренсена–Дайса) в диапазоне 0..1.
 * Дёшево и устойчиво к перестановкам слов — без LLM.
 */
export function trigramSimilarity(a: string, b: string): number {
  const na = normLoose(a);
  const nb = normLoose(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = trigrams(na);
  const tb = trigrams(nb);
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/** Базовые алиасы единиц (применяются всегда, и в сервере, и в CLI). */
export const DEFAULT_UNIT_ALIASES: Record<string, string> = {
  'м.п': 'м',
  'пог.м': 'м',
  'пог. м': 'м',
  компл: 'компл.',
  м2: 'м²',
  м3: 'м³',
  шт: 'шт',
};

/** Нормализация единицы измерения по словарю вариантов (поверх дефолтов). */
export function normUnit(unit: string | null, aliases: Record<string, string> = {}): string | null {
  if (!unit) return null;
  const n = norm(unit).replace(/\.$/, '');
  const merged = { ...DEFAULT_UNIT_ALIASES, ...aliases };
  return merged[n] ?? n;
}

/** Совпадают ли единицы измерения после нормализации. */
export function unitsMatch(
  a: string | null,
  b: string | null,
  aliases: Record<string, string> = {},
): boolean {
  const na = normUnit(a, aliases);
  const nb = normUnit(b, aliases);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Разбор русского числа из ячейки: «1 692,9» → 1692.9, «202,6» → 202.6.
 * Возвращает null, если число не распознано.
 */
export function parseRuNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw)
    .replace(/ /g, ' ')
    .replace(/\s+/g, '')
    .replace(',', '.');
  if (!cleaned || !/[\d]/.test(cleaned)) return null;
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
