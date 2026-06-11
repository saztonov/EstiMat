/**
 * Оркестратор ядра извлечения. Чистая функция: markdown + срез справочников +
 * правила (+ опционально LLM-порт) → ExtractionResult.
 *
 * Без LLM-порта работает чисто rule-based (структурные спец-таблицы). С портом
 * дополнительно разбирает неоднозначные таблицы/прозу и доматчивает остаток.
 *
 * Группировка: позиции спецификации — материалы; работа выводится из раздела
 * (sectionPath) по правилу sectionToWork либо как контейнер с именем раздела.
 */
import type {
  CatalogSnapshot,
  ExtractionResult,
  ExtractRules,
  ExtractedMaterial,
  ExtractedWork,
  LlmPort,
  RawSpecItem,
} from './types.js';
import { parseMarkdown } from './markdown-parser.js';
import { classifyTable } from './table-classifier.js';
import { extractSpecTable } from './spec-extractor.js';
import { matchItem } from './matcher.js';
import { norm } from './normalize.js';

const CONFIDENCE_REVIEW = 0.8;

function dedupeKey(item: RawSpecItem): string {
  return `${norm(item.rawName)}|${item.quantity ?? ''}|${item.unit ?? ''}|${item.sectionPath.join('>')}`;
}

/** Подобрать наименование работы для раздела по правилу sectionToWork. */
function workNameForSection(sectionPath: string[], rules: ExtractRules): string | null {
  const map = rules.sectionToWork ?? {};
  const hay = sectionPath.map((s) => norm(s));
  for (const [needle, work] of Object.entries(map)) {
    const n = norm(needle);
    if (hay.some((s) => s.includes(n))) return work;
  }
  return null;
}

export async function runExtraction(
  markdown: string,
  catalog: CatalogSnapshot,
  rules: ExtractRules = {},
  llm?: LlmPort,
): Promise<ExtractionResult> {
  const blocks = parseMarkdown(markdown);
  const anomalies: string[] = [];
  const rawItems: RawSpecItem[] = [];
  let tableCount = 0;
  let llmItemCount = 0;

  for (const block of blocks) {
    if (block.type === 'table') {
      tableCount++;
      const cls = classifyTable(block.headers, block.rows, rules);
      if (cls.kind === 'spec' && cls.confident) {
        const { items, anomalies: a } = extractSpecTable(
          block.headers,
          block.rows,
          cls.columns,
          block.sectionPath,
          rules,
        );
        rawItems.push(...items);
        anomalies.push(...a);
      } else if (cls.kind === 'ambiguous' && llm) {
        const items = await llm.extractItems(block.sourceSnippet, {
          sectionPath: block.sectionPath,
          rules,
        });
        llmItemCount += items.length;
        rawItems.push(...items);
      } else if (cls.kind === 'ambiguous') {
        anomalies.push(`Таблица не разобрана (нет LLM): ${cls.reason} — раздел «${block.sectionPath.join(' › ')}»`);
      }
    } else if (block.type === 'paragraph' && llm) {
      // Проза разбирается LLM только если есть числа (потенциальные объёмы).
      if (/\d/.test(block.text) && block.text.length > 20) {
        const items = await llm.extractItems(block.sourceSnippet, {
          sectionPath: block.sectionPath,
          rules,
        });
        llmItemCount += items.length;
        rawItems.push(...items);
      }
    }
  }

  // Дедупликация полностью одинаковых позиций.
  const seen = new Set<string>();
  const deduped = rawItems.filter((it) => {
    const k = dedupeKey(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Группировка по разделу (sectionPath) → работа + её материалы.
  const groups = new Map<string, RawSpecItem[]>();
  for (const item of deduped) {
    const key = item.sectionPath.join(' › ') || '(без раздела)';
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  const works: ExtractedWork[] = [];
  let matchedCount = 0;
  let needsReviewCount = 0;
  let materialCount = 0;

  for (const [sectionKey, items] of groups) {
    const sectionPath = items[0]?.sectionPath ?? [];
    const workName = workNameForSection(sectionPath, rules) ?? sectionKey;

    // Привязка работы к справочнику расценок.
    const workProbe: RawSpecItem = {
      rawName: workName,
      construction: null,
      quantity: 1,
      unit: null,
      mark: null,
      gost: null,
      sourceSnippet: sectionKey,
      kind: 'work',
      confidence: 0.5,
      sectionPath,
    };
    const workMatch = await matchItem(workProbe, catalog.rates, rules, llm);
    const workMatched = workMatch.decision === 'matched';
    if (workMatched) matchedCount++;

    // Материалы группы.
    const materials: ExtractedMaterial[] = [];
    for (const item of items) {
      const m = await matchItem(item, catalog.materials, rules, llm);
      const matched = m.decision === 'matched';
      if (matched) matchedCount++;
      const needsReview = !matched || item.quantity === null || m.confidence < CONFIDENCE_REVIEW;
      if (needsReview) needsReviewCount++;
      materialCount++;
      materials.push({
        description: m.matchedName ?? item.rawName,
        materialId: m.catalogId,
        quantity: item.quantity ?? 1,
        unit: m.unit ?? item.unit ?? 'шт',
        unitPrice: m.unitPrice ?? 0,
        confidence: m.confidence,
        needsReview,
        sourceSnippet: item.sourceSnippet,
        match: m,
      });
    }

    const workNeedsReview = !workMatched;
    if (workNeedsReview) needsReviewCount++;
    works.push({
      description: workMatch.matchedName ?? workName,
      rateId: workMatch.catalogId,
      costTypeId: workMatch.costTypeId,
      quantity: 1,
      unit: workMatch.unit ?? 'компл.',
      unitPrice: workMatch.unitPrice ?? 0,
      confidence: workMatch.confidence,
      needsReview: workNeedsReview,
      sourceSnippet: sectionKey,
      match: workMatch,
      materials,
    });
  }

  return {
    works,
    stats: {
      blocks: blocks.length,
      tables: tableCount,
      ruleItems: deduped.length - llmItemCount,
      llmItems: llmItemCount,
      works: works.length,
      materials: materialCount,
      matched: matchedCount,
      needsReview: needsReviewCount,
    },
    anomalies,
  };
}
