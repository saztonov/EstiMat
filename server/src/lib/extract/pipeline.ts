/**
 * Оркестратор ядра извлечения. Чистая функция: markdown + срез справочников +
 * правила (+ опционально LLM-порт) → ExtractionResult.
 *
 * Принципы (ведущий сметчик):
 *  - РАБОТЫ берутся ТОЛЬКО из справочника (suggestWorks); работы из текста РД не
 *    синтезируются (никаких контейнеров-разделов).
 *  - МАТЕРИАЛЫ извлекаются только из настоящих спецификаций (rule-based + сметчик-
 *    gated LLM), служебное содержание (маркировки/экспликации/штампы/общие указания)
 *    отбраковывается. ИИ распределяет материалы по подобранным работам; без подходящей
 *    работы — в единый контейнер MATERIALS_BUCKET.
 */
import type {
  CatalogEntry,
  CatalogSnapshot,
  ExtractionResult,
  ExtractRules,
  ExtractedMaterial,
  ExtractedWork,
  LlmPort,
  RawBlock,
  RawSpecItem,
  SectionScope,
} from './types.js';
import { MATERIALS_BUCKET } from './types.js';
import { parseMarkdown } from './markdown-parser.js';
import { classifyTable, normalizeTableHeader } from './table-classifier.js';
import { extractSpecTable, isNoiseSpecName } from './spec-extractor.js';
import { matchItem } from './matcher.js';
import { norm, trigramSimilarity } from './normalize.js';

const CONFIDENCE_REVIEW = 0.8;
/** Сколько кандидатов-расценок отдаём LLM для подбора работ (после ранжирования). */
const SUGGEST_TOPK = 200;

function dedupeKey(item: RawSpecItem): string {
  return `${norm(item.rawName)}|${item.quantity ?? ''}|${item.unit ?? ''}|${item.sectionPath.join('>')}`;
}

/** Прервать выполнение, если задание остановлено (AbortSignal). */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('aborted');
}

/** Артефакт распознавания RDLOCAL (метаданные блока-изображения) — не позиция сметы. */
function isRdlocalArtifact(text: string): boolean {
  const t = text.trimStart();
  if (/^\*\*\s*(Сущности|Краткое описание|Описание|Текст на чертеже)\s*:?\s*\*\*/i.test(t)) return true;
  if (/^\*\*\[ИЗОБРАЖЕНИЕ\]\*\*/i.test(t)) return true;
  return false;
}

/**
 * Ранжировать расценки по релевантности документу (макс. триграммная близость
 * имени/алиасов к терминам документа — заголовкам разделов) и вернуть top-K.
 */
function rankRatesByDocument(rates: CatalogEntry[], terms: string[], topK: number): CatalogEntry[] {
  if (rates.length <= topK || terms.length === 0) return rates.slice(0, topK);
  const scored = rates.map((e) => {
    const names = [e.name, ...e.aliases];
    let best = 0;
    for (const t of terms) for (const n of names) best = Math.max(best, trigramSimilarity(t, n));
    return { e, best };
  });
  scored.sort((a, b) => b.best - a.best);
  return scored.slice(0, topK).map((s) => s.e);
}

const DIGEST_LIMIT = 8000;

/** Сжатая выжимка документа для LLM-подбора работ (экономия токенов). */
function buildDocumentDigest(blocks: RawBlock[]): string {
  const parts: string[] = [];
  let len = 0;
  for (const b of blocks) {
    const piece =
      b.type === 'heading'
        ? `# ${b.text}`
        : b.type === 'paragraph'
          ? b.text
          : `[таблица: ${b.headers.join(' | ')}]`;
    parts.push(piece);
    len += piece.length + 1;
    if (len > DIGEST_LIMIT) break;
  }
  return parts.join('\n').slice(0, DIGEST_LIMIT);
}

export async function runExtraction(
  markdown: string,
  catalog: CatalogSnapshot,
  rules: ExtractRules = {},
  llm?: LlmPort,
  scope?: SectionScope,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const blocks = parseMarkdown(markdown);
  const anomalies: string[] = [];
  const rawItems: RawSpecItem[] = [];
  let tableCount = 0;
  let llmItemCount = 0;

  // 1–3. Сбор материалов-кандидатов из настоящих спецификаций.
  for (const block of blocks) {
    throwIfAborted(signal);
    if (block.type === 'table') {
      tableCount++;
      const tbl = normalizeTableHeader(block.headers, block.rows, rules);
      const cls = classifyTable(tbl.headers, tbl.rows, rules);
      if (cls.kind === 'spec' && cls.confident) {
        const { items, anomalies: a } = extractSpecTable(tbl.headers, tbl.rows, cls.columns, block.sectionPath, rules);
        rawItems.push(...items);
        anomalies.push(...a);
      } else if (cls.kind === 'ambiguous' && llm) {
        const items = await llm.extractItems(block.sourceSnippet, { sectionPath: block.sectionPath, rules });
        llmItemCount += items.length;
        rawItems.push(...items);
      } else if (cls.kind === 'ambiguous') {
        anomalies.push(`Таблица не разобрана (нет LLM): ${cls.reason} — раздел «${block.sectionPath.join(' › ')}»`);
      }
      // cls.kind === 'skip' — служебная/не-спецификация, игнорируем.
    } else if (block.type === 'paragraph' && block.isDrawingText) {
      // Распознанный текст чертежа: только LLM-сметчик (отбракует легенды/маркировки).
      if (llm) {
        const items = await llm.extractItems(block.text, { sectionPath: block.sectionPath, rules, kind: 'drawing' });
        llmItemCount += items.length;
        rawItems.push(...items);
      } else {
        anomalies.push(`Текст чертежа не разобран без LLM — раздел «${block.sectionPath.join(' › ')}»`);
      }
    } else if (block.type === 'paragraph' && llm) {
      // Проза: пропускаем RDLOCAL-артефакты (Сущности/Описание/изображения); прочее с числами — в LLM.
      if (!isRdlocalArtifact(block.text) && /\d/.test(block.text) && block.text.length > 20) {
        const items = await llm.extractItems(block.sourceSnippet, { sectionPath: block.sectionPath, rules, kind: 'prose' });
        llmItemCount += items.length;
        rawItems.push(...items);
      }
    }
  }

  // Дедуп + сметчицкий фильтр шума (маркировки/оси/этажность) — на всё, включая LLM.
  const seen = new Set<string>();
  const deduped = rawItems.filter((it) => {
    if (!it.rawName || isNoiseSpecName(it.rawName, it.unit)) return false;
    const k = dedupeKey(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 4. Материалы-кандидаты (плоско): матчинг к справочнику материалов.
  let matchedCount = 0;
  let needsReviewCount = 0;
  const materials: ExtractedMaterial[] = [];
  for (const item of deduped) {
    throwIfAborted(signal);
    const m = await matchItem(item, catalog.materials, rules, llm);
    const matched = m.decision === 'matched';
    if (matched) matchedCount++;
    const needsReview = !matched || item.quantity === null || m.confidence < CONFIDENCE_REVIEW;
    if (needsReview) needsReviewCount++;
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

  // 5. Работы — ТОЛЬКО из справочника (suggestWorks). Контейнеры-разделы не создаём.
  const works: ExtractedWork[] = [];
  if (llm && catalog.rates.length > 0) {
    throwIfAborted(signal);
    const effectiveScope: SectionScope = scope ?? { categoryIds: [], costTypeIds: [] };
    const noScope = effectiveScope.categoryIds.length === 0 && effectiveScope.costTypeIds.length === 0;
    const digest = buildDocumentDigest(blocks);
    const terms = [...new Set(blocks.flatMap((b) => (b.type === 'heading' ? [b.text] : [])))];
    const ranked = noScope ? rankRatesByDocument(catalog.rates, terms, SUGGEST_TOPK) : catalog.rates;
    if (noScope) {
      anomalies.push(`Подбор работ по всему справочнику (${catalog.rates.length} расценок); для точности выберите раздел.`);
    }
    const candidates = ranked.map((e) => ({ id: e.id, name: e.name, unit: e.unit }));
    const suggested = await llm.suggestWorks(digest, candidates, { scope: effectiveScope, rules });
    const seenRate = new Set<string>();
    for (const s of suggested) {
      const entry = catalog.rates.find((e) => e.id === s.id);
      // Инвариант: работа создаётся только из реальной расценки с видом затрат.
      if (!entry || !entry.costTypeId || seenRate.has(entry.id)) continue;
      seenRate.add(entry.id);
      matchedCount++;
      needsReviewCount++;
      works.push({
        description: entry.name,
        rateId: entry.id,
        costTypeId: entry.costTypeId,
        quantity: 1,
        unit: entry.unit ?? 'компл.',
        unitPrice: entry.price ?? 0,
        confidence: s.confidence,
        needsReview: true,
        sourceSnippet: null,
        match: {
          catalogId: entry.id,
          matchedName: entry.name,
          unitPrice: entry.price,
          unit: entry.unit,
          costTypeId: entry.costTypeId,
          decision: 'matched',
          via: 'llm',
          confidence: s.confidence,
        },
        materials: [],
      });
    }
  }

  // 6–7. Распределение материалов по работам (ИИ); без работ/LLM — в общий список.
  const byRate = new Map<string, ExtractedWork>(works.map((w) => [w.rateId as string, w]));
  const bucketMaterials: ExtractedMaterial[] = [];
  if (materials.length > 0) {
    let assignment: { index: number; workId: string | null }[] = materials.map((_, i) => ({ index: i, workId: null }));
    if (llm && works.length > 0) {
      throwIfAborted(signal);
      assignment = await llm.assignMaterials(
        materials.map((m, i) => ({ index: i, name: m.description, unit: m.unit, section: null })),
        works.map((w) => ({ id: w.rateId as string, name: w.description })),
        { rules },
      );
    }
    const widByIndex = new Map(assignment.map((a) => [a.index, a.workId]));
    materials.forEach((m, i) => {
      const wid = widByIndex.get(i) ?? null;
      const w = wid ? byRate.get(wid) : undefined;
      if (w) w.materials.push(m);
      else bucketMaterials.push(m);
    });
  }

  // Единственная допустимая «работа» без rateId — контейнер нераспределённых материалов.
  if (bucketMaterials.length > 0) {
    works.push({
      description: MATERIALS_BUCKET,
      rateId: null,
      costTypeId: null,
      quantity: 1,
      unit: 'компл.',
      unitPrice: 0,
      confidence: 0,
      needsReview: true,
      sourceSnippet: null,
      match: { catalogId: null, matchedName: null, unitPrice: null, unit: null, costTypeId: null, decision: 'unmatched', via: 'none', confidence: 0 },
      materials: bucketMaterials,
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
      materials: materials.length,
      matched: matchedCount,
      needsReview: needsReviewCount,
    },
    anomalies,
  };
}
