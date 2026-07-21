import { z } from 'zod';

/**
 * Распознавание счёта поставщика и сверка его с заказом.
 *
 * ДЕНЬГИ И КОЛИЧЕСТВА — СТРОКАМИ. Модель возвращает «1 234,56 ₽», «(1200)», «—»; приводим их к
 * канонической десятичной строке препроцессом, а не через Number: правило проекта (деньги считаем
 * numeric), плюс на больших суммах float теряет копейки.
 *
 * СХЕМА НАМЕРЕННО ТЕРПИМАЯ. Жёсткая валидация даты или перечисления превратила бы одну кривую
 * ячейку в полный провал распознавания, хотя остальные 20 строк счёта разобрались верно.
 */

/** Привести число из документа к десятичной строке. null — распознать не удалось. */
export function normalizeNumericString(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== 'string') return null;

  let s = raw.trim();
  if (!s || s === '—' || s === '-' || s === '–') return null;
  // Скобочная запись отрицательных сумм в бухгалтерских формах: (1 200) = −1200.
  const negated = /^\(.*\)$/.test(s);
  if (negated) s = s.slice(1, -1);
  // Валюты, неразрывные пробелы и разделители разрядов.
  s = s.replace(/[₽$€]|руб\.?|коп\.?/gi, '').replace(/[\s  ']/g, '').trim();
  // Десятичная запятая → точка. Точка-разделитель тысяч встречается редко и здесь не поддержана
  // намеренно: угадывание «1.200» как тысячи ошибётся на «1.200» как 1,2.
  s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const out = negated ? `-${s}` : s;
  return out;
}

const numeric = z.preprocess(normalizeNumericString, z.string().nullable());

/** Строка табличной части счёта — как напечатано, без домысливания. */
export const recognizedInvoiceLineSchema = z.object({
  lineNo: z.number().int().nullish(),
  name: z.string().min(1),
  unit: z.string().nullish(),
  quantity: numeric,
  unitPrice: numeric,
  amountNet: numeric,
  vatAmount: numeric,
  amountTotal: numeric,
});
export type RecognizedInvoiceLine = z.infer<typeof recognizedInvoiceLineSchema>;

/** Как в документе указан НДС: он определяет, с чем сравнивать итоги заказа. */
export const VAT_MODES = ['included', 'excluded', 'none', 'unknown'] as const;
export type VatMode = (typeof VAT_MODES)[number];

export const recognizedInvoiceSchema = z.object({
  documentType: z.enum(['invoice', 'invoice_factura', 'upd', 'quote', 'act', 'other', 'unknown']).catch('unknown'),
  invoiceNo: z.string().max(100).nullish(),
  // Дата мягко: неверный формат не должен обнулять весь разбор.
  invoiceDate: z.string().nullish(),
  supplier: z.object({
    name: z.string().nullish(), inn: z.string().nullish(), kpp: z.string().nullish(),
  }).nullish(),
  buyer: z.object({ name: z.string().nullish(), inn: z.string().nullish() }).nullish(),
  currency: z.string().default('RUB'),
  vatMode: z.enum(VAT_MODES).catch('unknown'),
  /** Ставка в процентах: 20 | 10 | 0. */
  vatRate: z.number().nullish(),
  items: z.array(recognizedInvoiceLineSchema).default([]),
  totals: z.object({ net: numeric, vat: numeric, total: numeric }).nullish(),
  notes: z.string().max(2000).nullish(),
  confidence: z.enum(['high', 'medium', 'low']).catch('low'),
});
export type RecognizedInvoice = z.infer<typeof recognizedInvoiceSchema>;

// ===== Результат сверки с заказом =====

export const INVOICE_MATCH_STATUSES = ['match', 'warn', 'unknown'] as const;
export type InvoiceMatchStatus = (typeof INVOICE_MATCH_STATUSES)[number];

export interface InvoiceTotalsCheck {
  field: 'net' | 'vat' | 'total';
  order: string | null;
  invoice: string | null;
  diff: string | null;
  status: 'ok' | 'warn' | 'unknown';
}

export interface InvoiceLineCheck {
  aggKey: string | null;
  orderName: string | null;
  invoiceName: string | null;
  orderQty: string | null;
  invoiceQty: string | null;
  orderPrice: string | null;
  invoicePrice: string | null;
  /** Схожесть названий (0..1) при нечётком сопоставлении. */
  matchScore: number | null;
  status: 'ok' | 'qty_diff' | 'price_diff' | 'unmatched_invoice' | 'missing_in_invoice';
}

export interface InvoiceMatchResult {
  status: InvoiceMatchStatus;
  totals: InvoiceTotalsCheck[];
  vat: {
    orderRate: number | null;
    invoiceRate: number | null;
    mode: VatMode;
    status: 'ok' | 'warn' | 'unknown';
  };
  lines: InvoiceLineCheck[];
  /** Готовые формулировки для баннера — сверка не блокирует, но должна быть понятна. */
  warnings: string[];
}

/** Статусы распознавания. 'unsupported' — формат или настройка не позволяют, это не ошибка. */
export const RECOGNITION_STATUSES = [
  'not_run', 'queued', 'running', 'succeeded', 'failed', 'unsupported',
] as const;
export type RecognitionStatus = (typeof RECOGNITION_STATUSES)[number];

export const RECOGNITION_STATUS_LABELS: Record<RecognitionStatus, string> = {
  not_run: 'Не распознавался',
  queued: 'В очереди',
  running: 'Распознаётся',
  succeeded: 'Распознан',
  failed: 'Ошибка распознавания',
  unsupported: 'Распознавание недоступно',
};
