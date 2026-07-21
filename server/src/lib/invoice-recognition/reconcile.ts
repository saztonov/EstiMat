/**
 * Сверка распознанного счёта с заказом.
 *
 * ЧИСТАЯ функция без БД: правила сравнения — доменная логика, и они должны быть покрыты тестами,
 * а не проверяться глазами на проде. Считает СЕРВЕР, а не клиент: тот же результат нужен и для
 * признака в реестре, и дублировать правила в двух местах нельзя.
 *
 * АРИФМЕТИКА В КОПЕЙКАХ (BigInt). Деньги приходят десятичными строками; сложение их через Number
 * теряет копейки на суммах в миллионы — ровно там, где расхождение и важно.
 *
 * СВЕРКА НИЧЕГО НЕ БЛОКИРУЕТ. Её задача — показать расхождение, а решение принимает снабженец:
 * распознавание ошибается, и жёсткий запрет останавливал бы работу на ровном месте.
 */
import type {
  RecognizedInvoice, InvoiceMatchResult, InvoiceLineCheck, InvoiceTotalsCheck, VatMode,
} from '@estimat/shared';

/** Позиция заказа для сверки (агрегат материала). */
export interface OrderSnapshotLine {
  aggKey: string;
  name: string;
  unit: string;
  /** Количество, десятичной строкой. */
  quantity: string;
  /** Цена за единицу без НДС; null — цена ещё не задана. */
  unitPrice: string | null;
}

export interface OrderSnapshot {
  lines: OrderSnapshotLine[];
  /** Ставка НДС заказа в процентах (0 или 22). */
  vatRatePercent: number | null;
  /** Итог заказа с НДС, десятичной строкой. */
  amount: string | null;
}

// ---- деньги в копейках ----

/** Десятичная строка → копейки. null, если значения нет. */
export function toCents(v: string | null | undefined): bigint | null {
  if (v == null || v === '') return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const frac = (m[3] ?? '').padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(m[2]!) * 100n + BigInt(frac));
}

const centsToStr = (c: bigint): string => {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

const absBig = (v: bigint) => (v < 0n ? -v : v);

/**
 * Допуск по деньгам: рубль или полпроцента суммы заказа, что больше. Построчное округление у
 * разных учётных систем расходится на копейки, а на суммах в миллионы — уже на рубли.
 */
export function moneyTolerance(orderTotalCents: bigint | null): bigint {
  const base = 100n; // 1.00 ₽
  if (orderTotalCents == null) return base;
  const half = absBig(orderTotalCents) / 200n; // 0.5 %
  return half > base ? half : base;
}

// ---- количества ----

const toNum = (v: string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Количества сходятся: 0.1 % относительной либо 0.001 абсолютной разницы. */
export function qtyMatches(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= 0.001 || diff <= Math.abs(a) * 0.001;
}

// ---- сопоставление названий ----

/** Нормализация названия: регистр, пробелы, кавычки и хвосты вроде ГОСТ/ТУ к сравнению не относятся. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»"'`]/g, ' ')
    // Ссылку на норматив и всё, что за ней, отбрасываем: «ГОСТ 530-2012» уточняет материал, но
    // в счёте его пишут не всегда, и его наличие не должно мешать сопоставлению.
    // \b здесь неприменим: в JS граница слова считается по латинице, для кириллицы она не
    // срабатывает — поэтому начало проверяем явно (начало строки либо не-буква).
    .replace(/(^|[^\p{L}])(гост|ту|сп|снип)[^,;]*/gu, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Схожесть по коэффициенту Дайса на биграммах.
 *
 * Реализовано в JS, а не через pg_trgm: расширение включается вручную в кабинете управляемой БД и
 * есть не на всех инсталляциях — сверка не должна зависеть ни от него, ни от БД вообще.
 */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const n of A.values()) sizeA += n;
  for (const n of B.values()) sizeB += n;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  return (2 * common) / (sizeA + sizeB);
}

/** Ниже этого порога совпадение не признаём: лучше «не сопоставлено», чем неверная пара. */
export const MATCH_THRESHOLD = 0.55;

// ---- сверка ----

export function reconcileInvoice(order: OrderSnapshot, rec: RecognizedInvoice): InvoiceMatchResult {
  const warnings: string[] = [];
  const orderTotalCents = toCents(order.amount);

  // --- позиции: жадное назначение один-к-одному по убыванию схожести ---
  const invLines = rec.items ?? [];
  const pairs: { oi: number; ii: number; score: number }[] = [];
  order.lines.forEach((o, oi) => {
    const on = normalizeName(o.name);
    invLines.forEach((inv, ii) => {
      const score = diceSimilarity(on, normalizeName(inv.name));
      if (score >= MATCH_THRESHOLD) pairs.push({ oi, ii, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const orderTaken = new Set<number>();
  const invTaken = new Set<number>();
  const matched: { oi: number; ii: number; score: number }[] = [];
  for (const p of pairs) {
    if (orderTaken.has(p.oi) || invTaken.has(p.ii)) continue;
    orderTaken.add(p.oi);
    invTaken.add(p.ii);
    matched.push(p);
  }

  const lines: InvoiceLineCheck[] = [];
  for (const { oi, ii, score } of matched) {
    const o = order.lines[oi]!;
    const inv = invLines[ii]!;
    const oQty = toNum(o.quantity);
    const iQty = toNum(inv.quantity);
    const oPrice = toCents(o.unitPrice);
    const iPrice = toCents(inv.unitPrice);

    let status: InvoiceLineCheck['status'] = 'ok';
    if (oQty != null && iQty != null && !qtyMatches(oQty, iQty)) status = 'qty_diff';
    else if (oPrice != null && iPrice != null && absBig(oPrice - iPrice) > 1n) status = 'price_diff';

    if (status === 'qty_diff') warnings.push(`«${o.name}»: количество в счёте ${inv.quantity} вместо ${o.quantity}`);
    if (status === 'price_diff') warnings.push(`«${o.name}»: цена в счёте ${inv.unitPrice} вместо ${o.unitPrice}`);

    lines.push({
      aggKey: o.aggKey, orderName: o.name, invoiceName: inv.name,
      orderQty: o.quantity, invoiceQty: inv.quantity,
      orderPrice: o.unitPrice, invoicePrice: inv.unitPrice,
      matchScore: Number(score.toFixed(2)), status,
    });
  }

  order.lines.forEach((o, oi) => {
    if (orderTaken.has(oi)) return;
    lines.push({
      aggKey: o.aggKey, orderName: o.name, invoiceName: null,
      orderQty: o.quantity, invoiceQty: null, orderPrice: o.unitPrice, invoicePrice: null,
      matchScore: null, status: 'missing_in_invoice',
    });
    warnings.push(`«${o.name}» есть в заказе, но не найден в счёте`);
  });

  invLines.forEach((inv, ii) => {
    if (invTaken.has(ii)) return;
    lines.push({
      aggKey: null, orderName: null, invoiceName: inv.name,
      orderQty: null, invoiceQty: inv.quantity, orderPrice: null, invoicePrice: inv.unitPrice,
      matchScore: null, status: 'unmatched_invoice',
    });
    warnings.push(`«${inv.name}» есть в счёте, но не найден в заказе`);
  });

  // --- итоги ---
  const tol = moneyTolerance(orderTotalCents);
  const invTotalCents = toCents(rec.totals?.total ?? null);
  const totals: InvoiceTotalsCheck[] = [];
  if (orderTotalCents == null || invTotalCents == null) {
    totals.push({
      field: 'total', order: order.amount ?? null, invoice: rec.totals?.total ?? null,
      diff: null, status: 'unknown',
    });
  } else {
    const diff = invTotalCents - orderTotalCents;
    const ok = absBig(diff) <= tol;
    totals.push({
      field: 'total', order: order.amount, invoice: rec.totals?.total ?? null,
      diff: centsToStr(diff), status: ok ? 'ok' : 'warn',
    });
    if (!ok) warnings.push(`Сумма счёта отличается от суммы заказа на ${centsToStr(diff)} ₽`);
  }

  // --- НДС ---
  const mode: VatMode = rec.vatMode ?? 'unknown';
  let vatStatus: 'ok' | 'warn' | 'unknown' = 'unknown';
  if (rec.vatRate != null && order.vatRatePercent != null) {
    vatStatus = Math.abs(rec.vatRate - order.vatRatePercent) < 0.01 ? 'ok' : 'warn';
    if (vatStatus === 'warn') {
      warnings.push(`Ставка НДС в счёте ${rec.vatRate}% вместо ${order.vatRatePercent}%`);
    }
  }
  // «Без НДС» при ненулевой ставке заказа — расхождение, даже если ставка в счёте не указана.
  if (mode === 'none' && (order.vatRatePercent ?? 0) > 0) {
    vatStatus = 'warn';
    warnings.push('Счёт выставлен без НДС, а в заказе НДС предусмотрен');
  }

  const hasWarn =
    totals.some((t) => t.status === 'warn')
    || vatStatus === 'warn'
    || lines.some((l) => l.status !== 'ok');
  const allUnknown = totals.every((t) => t.status === 'unknown') && !lines.length;

  return {
    status: allUnknown ? 'unknown' : hasWarn ? 'warn' : 'match',
    totals,
    vat: { orderRate: order.vatRatePercent, invoiceRate: rec.vatRate ?? null, mode, status: vatStatus },
    lines,
    warnings,
  };
}
