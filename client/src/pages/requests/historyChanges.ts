import { REQUEST_STATUS_LABELS, type RequestStatus } from '@estimat/shared';

/**
 * Расшифровка поля changes записи истории заявки.
 *
 * До этого changes приходил на клиент и нигде не рендерился: комментарий доработки и причина
 * отмены были не видны, хотя сервер их писал. Логика вынесена в .ts (без React), потому что
 * тестовые наборы проекта берут только *.test.ts; рендер — в historyChanges.tsx.
 *
 * Неизвестные действия дают null: сырой JSON в ленте истории показывать нельзя.
 */
export interface ChangeLine {
  /** Свободный текст (комментарий, причина) — рисуется курсивом в кавычках. */
  quote?: string;
  /** Короткие факты: «Из „В работе“ в „Выбран поставщик“», «Кирпич: 10 → 8». */
  facts: string[];
  /** Пометка о перезаказе — рисуется красным тегом. */
  warn?: string;
}

type Changes = Record<string, unknown> | null | undefined;

const statusLabel = (v: unknown): string =>
  (typeof v === 'string' && REQUEST_STATUS_LABELS[v as RequestStatus]) || String(v ?? '');

const num = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : String(v ?? '');
};

/** Сколько правок объёма показывать поимённо, прежде чем свернуть в «и ещё N». */
const MAX_ITEMS = 3;

export function describeChanges(action: string, changes: Changes): ChangeLine | null {
  if (!changes || typeof changes !== 'object') return null;
  const c = changes as Record<string, unknown>;
  const facts: string[] = [];

  // Комментарий доработки и причина отмены пишутся сервером, но раньше не отображались.
  const quote = typeof c.comment === 'string' && c.comment.trim()
    ? c.comment.trim()
    : typeof c.reason === 'string' && c.reason.trim()
      ? c.reason.trim()
      : undefined;

  if (action === 'status_changed' && (c.from || c.to)) {
    facts.push(`Из «${statusLabel(c.from)}» в «${statusLabel(c.to)}»`);
  }

  if (action === 'items_quantity_updated' && Array.isArray(c.items)) {
    const items = c.items as { name?: unknown; from?: unknown; to?: unknown }[];
    for (const it of items.slice(0, MAX_ITEMS)) {
      facts.push(`${String(it.name ?? '—')}: ${num(it.from)} → ${num(it.to)}`);
    }
    if (items.length > MAX_ITEMS) facts.push(`и ещё ${items.length - MAX_ITEMS}`);
  }

  if (action === 'supplier_selected' && typeof c.supplierName === 'string') {
    facts.push(c.supplierName);
  }
  if (action === 'payment_added' && c.amount != null) {
    facts.push(`${num(c.amount)} ₽`);
  }

  const overplaced = Array.isArray(c.overplaced) ? c.overplaced.length : 0;
  const warn = overplaced > 0 ? `перезаказ: ${overplaced}` : undefined;

  if (!quote && facts.length === 0 && !warn) return null;
  return { quote, facts, warn };
}
