/**
 * Разбор ответа модели — ручной allowlist по idx, как в extract-порте, а не Zod.
 *
 * Zod здесь вреден: safeParse даёт «всё или ничего», а на LM Studio батч считается минутами —
 * терять весь ответ из-за одной кривой группы нельзя. Битая группа выбрасывается, остальные
 * выживают. Zod применяется на границе API (shared-схемы), где ответ уже собран.
 *
 * Модель возвращает idx (1..N в пределах батча), а не ключи заказа: ключ — это 78 символов
 * UUID, и одно только их эхо на смету стоило бы ~18 000 токенов при лимите вывода 8192.
 */
import { extractJson } from '../llm/json.js';
import type { DraftBatch, DraftGroup, GroupingBatch } from './types.js';

const COMPLETENESS = new Set(['complete', 'incomplete', 'unknown']);
const COMPATIBILITY = new Set(['no_issues', 'possible_issue', 'unknown']);
const SEVERITY = new Set(['warning', 'review', 'recommendation']);
const NEED = new Set(['required', 'conditional', 'recommended']);

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** idx → ключ заказа. Всё, что вне диапазона батча, отбрасывается. */
function mapIdx(raw: unknown, batch: GroupingBatch, seen: Set<string>, warnings: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > batch.lines.length) {
      warnings.push(`Набор ${batch.index + 1}: модель указала несуществующую позицию ${String(v)}`);
      continue;
    }
    const key = batch.lines[n - 1]!.orderKey;
    // Строка максимум в одной группе: дубль обрабатывается вызывающим (уходит в «требует
    // проверки»), а не достаётся первой группе по случайности порядка.
    if (seen.has(key)) continue;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Разобрать ответ батча. Строки, которые модель не упомянула или упомянула дважды, вернутся
 * в ungrouped — итоговое разбиение собирает assemble.ts, здесь только чистка.
 */
export function parseBatchResponse(raw: string, batch: GroupingBatch): DraftBatch {
  const warnings: string[] = [];
  const empty: DraftBatch = {
    batchIndex: batch.index,
    partitionKey: batch.partitionKey,
    groups: [],
    sharedKeys: [],
    ungroupedKeys: [],
    warnings,
  };

  const parsed = asRecord(extractJson(raw));
  if (!parsed) {
    warnings.push(`Набор ${batch.index + 1}: ответ модели не разобран как JSON`);
    return empty;
  }

  // Ключи, встреченные более одного раза, — кандидаты в «требует проверки».
  const claimed = new Map<string, number>();
  const countClaims = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= batch.lines.length) {
        const key = batch.lines[n - 1]!.orderKey;
        claimed.set(key, (claimed.get(key) ?? 0) + 1);
      }
    }
  };
  const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
  for (const g of rawGroups) countClaims(asRecord(g)?.idx);

  const duplicated = new Set([...claimed].filter(([, n]) => n > 1).map(([k]) => k));
  if (duplicated.size) {
    warnings.push(
      `Набор ${batch.index + 1}: ${duplicated.size} поз. модель отнесла к нескольким операциям — перенесены в «Не удалось сгруппировать»`,
    );
  }

  const groups: DraftGroup[] = [];
  let seq = 0;
  for (const raw of rawGroups) {
    const g = asRecord(raw);
    const name = g ? str(g.name) : null;
    if (!g || !name) {
      warnings.push(`Набор ${batch.index + 1}: группа без названия отброшена`);
      continue;
    }
    const orderKeys = mapIdx(g.idx, batch, duplicated, warnings);
    if (orderKeys.length === 0) continue; // группа опустела после чистки — её нет

    const completeness = str(g.completeness);
    const compatibility = str(g.compatibility);
    groups.push({
      id: `b${batch.index}g${seq++}`,
      batchIndex: batch.index,
      partitionKey: batch.partitionKey,
      name,
      purpose: g ? str(g.purpose) : null,
      // Недопустимое или отсутствующее значение → unknown: «не знаю» безопаснее выдумки.
      completeness: (completeness && COMPLETENESS.has(completeness) ? completeness : 'unknown') as DraftGroup['completeness'],
      compatibility: (compatibility && COMPATIBILITY.has(compatibility)
        ? compatibility
        : 'unknown') as DraftGroup['compatibility'],
      orderKeys,
      issues: parseIssues(g.issues, batch, duplicated, warnings),
      missing: parseMissing(g.missing),
    });
  }

  return {
    batchIndex: batch.index,
    partitionKey: batch.partitionKey,
    groups,
    sharedKeys: mapIdx(parsed.shared, batch, duplicated, warnings),
    ungroupedKeys: [...mapIdx(parsed.ungrouped, batch, duplicated, warnings), ...duplicated],
    warnings,
  };
}

function parseIssues(
  raw: unknown,
  batch: GroupingBatch,
  skip: Set<string>,
  warnings: string[],
): DraftGroup['issues'] {
  if (!Array.isArray(raw)) return [];
  const out: DraftGroup['issues'] = [];
  for (const item of raw) {
    const r = asRecord(item);
    const message = r ? str(r.message) : null;
    if (!r || !message) continue;
    const severity = str(r.severity);
    out.push({
      severity: (severity && SEVERITY.has(severity) ? severity : 'review') as DraftGroup['issues'][number]['severity'],
      message,
      orderKeys: mapIdx(r.idx, batch, skip, warnings),
    });
  }
  return out;
}

function parseMissing(raw: unknown): DraftGroup['missing'] {
  if (!Array.isArray(raw)) return [];
  const out: DraftGroup['missing'] = [];
  for (const item of raw) {
    const r = asRecord(item);
    const name = r ? str(r.name) : null;
    if (!r || !name) continue;
    const need = str(r.need);
    out.push({
      name,
      reason: str(r.reason) ?? '',
      need: (need && NEED.has(need) ? need : 'recommended') as DraftGroup['missing'][number]['need'],
    });
  }
  return out;
}

/** Разбор ответа фазы слияния. Неизвестные id игнорируются. */
export function parseMergeResponse(raw: string, known: Set<string>): { into: string; from: string[]; name: string | null }[] {
  const parsed = asRecord(extractJson(raw));
  const list = parsed && Array.isArray(parsed.merge) ? parsed.merge : [];
  const out: { into: string; from: string[]; name: string | null }[] = [];
  for (const item of list) {
    const r = asRecord(item);
    const into = r ? str(r.into) : null;
    if (!r || !into || !known.has(into)) continue;
    const from = Array.isArray(r.from)
      ? r.from.map((v) => str(v)).filter((v): v is string => !!v && known.has(v) && v !== into)
      : [];
    if (from.length) out.push({ into, from, name: str(r.name) });
  }
  return out;
}
