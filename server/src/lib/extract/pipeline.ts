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
  ReviewReason,
  SectionScope,
} from './types.js';
import { MATERIALS_BUCKET } from './types.js';
import { parseMarkdown } from './markdown-parser.js';
import { classifyTable, normalizeTableHeader } from './table-classifier.js';
import { extractSpecTable, isNoiseSpecName } from './spec-extractor.js';
import { norm, normUnit, unitsMatch, trigramSimilarity } from './normalize.js';

/** Сколько кандидатов-расценок отдаём LLM в fallback-подборе работ (без sweep). */
const SUGGEST_TOPK = 200;
/** Максимум работ в одном чанке систематического обхода справочника (Pass 1/2). */
const CHUNK_SIZE = 40;
/** Размер батча материалов при распределении по работам (защита от лимита вызова). */
const MATERIAL_BATCH = 60;

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

/** Раздел-чанк справочника для систематического обхода (один вид затрат). */
interface WorkChunk {
  title: string;
  entries: CatalogEntry[];
}

/**
 * Разбить справочник работ на чанки по виду затрат в стабильном порядке
 * «фундамент → отделка» (sortKey). Каждая работа попадает ровно в один чанк —
 * это и есть полный обход (Pass 1/2), ничего не пропускается. Крупные виды
 * дробятся до CHUNK_SIZE.
 */
function chunkRatesByCostType(rates: CatalogEntry[]): WorkChunk[] {
  const sorted = [...rates].sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
  const groups = new Map<string, CatalogEntry[]>();
  const titleByKey = new Map<string, string>();
  for (const e of sorted) {
    const key = e.costTypeId ?? '∅';
    if (!groups.has(key)) {
      groups.set(key, []);
      const title = [e.categoryName?.trim(), e.costTypeName?.trim()].filter(Boolean).join(' › ');
      titleByKey.set(key, title || 'Прочие работы');
    }
    groups.get(key)!.push(e);
  }
  const chunks: WorkChunk[] = [];
  for (const [key, entries] of groups) {
    const title = titleByKey.get(key)!;
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      chunks.push({ title, entries: entries.slice(i, i + CHUNK_SIZE) });
    }
  }
  return chunks;
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

  // 4. Материалы — ФАКТЫ из РД. AI не набирает материалы из справочников: позиция
  // сохраняется как в документе (materialId=null, имя/кол-во/единица из РД), всегда
  // на согласование. Привязку к работе делают Pass 1/2 ниже.
  const NO_MATCH = {
    catalogId: null,
    matchedName: null,
    unitPrice: null,
    unit: null,
    costTypeId: null,
    decision: 'unmatched' as const,
    via: 'none' as const,
    confidence: 0,
  };
  const materials: ExtractedMaterial[] = deduped.map((item) => ({
    description: item.rawName,
    materialId: null,
    quantity: item.quantity ?? 1,
    unit: normUnit(item.unit, rules.unitAliases) ?? item.unit ?? 'шт',
    unitPrice: 0,
    confidence: item.confidence,
    needsReview: true,
    reviewReason: item.quantity === null ? ('qty_unknown' as const) : undefined,
    sourceSnippet: item.sourceSnippet,
    match: { ...NO_MATCH },
  }));

  // Общий конструктор работы из справочной расценки (дедуп по rateId). Все работы
  // автоподбора идут на согласование. Переиспользуется Pass 1 и Pass 2.
  const works: ExtractedWork[] = [];
  const seenRate = new Set<string>();
  let worksFromSweep = 0;
  let materialsSweepAssigned = 0;
  function pushWorkFromEntry(
    entry: CatalogEntry,
    confidence: number,
    reason: ReviewReason,
  ): ExtractedWork | null {
    // Инвариант: работа создаётся только из реальной расценки с видом затрат.
    if (!entry.costTypeId || seenRate.has(entry.id)) return null;
    seenRate.add(entry.id);
    const w: ExtractedWork = {
      description: entry.name,
      rateId: entry.id,
      costTypeId: entry.costTypeId,
      quantity: 1,
      unit: entry.unit ?? 'компл.',
      unitPrice: entry.price ?? 0,
      confidence,
      needsReview: true,
      reviewReason: reason,
      sourceSnippet: null,
      match: {
        catalogId: entry.id,
        matchedName: entry.name,
        unitPrice: entry.price,
        unit: entry.unit,
        costTypeId: entry.costTypeId,
        decision: 'matched',
        via: 'llm',
        confidence,
      },
      materials: [],
    };
    works.push(w);
    return w;
  }

  // 5. Pass 1 — ПОЛНЫЙ обход справочника работ. Для каждого раздела-чанка LLM
  // выбирает работы, применимые к РД. Порт без sweepWorks → fallback (top-K).
  if (llm && catalog.rates.length > 0) {
    throwIfAborted(signal);
    const effectiveScope: SectionScope = scope ?? { categoryIds: [], costTypeIds: [] };
    const digest = buildDocumentDigest(blocks);
    const materialNames = materials.map((m) => m.description);
    if (llm.sweepWorks) {
      for (const chunk of chunkRatesByCostType(catalog.rates)) {
        throwIfAborted(signal);
        const suggested = await llm.sweepWorks(
          chunk.title,
          chunk.entries.map((e) => ({ id: e.id, name: e.name, unit: e.unit })),
          digest,
          materialNames,
          { scope: effectiveScope, rules },
        );
        for (const s of suggested) {
          const entry = chunk.entries.find((e) => e.id === s.id);
          if (entry && pushWorkFromEntry(entry, s.confidence, 'pass1_context')) worksFromSweep++;
        }
      }
    } else {
      // Совместимость: старый порт без обхода — прежний путь top-K + один suggestWorks.
      const noScope = effectiveScope.categoryIds.length === 0 && effectiveScope.costTypeIds.length === 0;
      const terms = [...new Set(blocks.flatMap((b) => (b.type === 'heading' ? [b.text] : [])))];
      const ranked = noScope ? rankRatesByDocument(catalog.rates, terms, SUGGEST_TOPK) : catalog.rates;
      const candidates = ranked.map((e) => ({ id: e.id, name: e.name, unit: e.unit }));
      const suggested = await llm.suggestWorks(digest, candidates, { scope: effectiveScope, rules });
      for (const s of suggested) {
        const entry = catalog.rates.find((e) => e.id === s.id);
        if (entry) pushWorkFromEntry(entry, s.confidence, 'pass1_context');
      }
    }
  }

  // 6. Распределение материалов по подобранным работам — батчами (защита от лимита).
  const byRate = new Map<string, ExtractedWork>(works.map((w) => [w.rateId as string, w]));
  const stillUnassigned: ExtractedMaterial[] = [];
  if (materials.length > 0 && llm && works.length > 0) {
    const workRefs = works.map((w) => ({ id: w.rateId as string, name: w.description }));
    const widByIndex = new Map<number, string | null>();
    for (let i = 0; i < materials.length; i += MATERIAL_BATCH) {
      throwIfAborted(signal);
      const batch = materials.slice(i, i + MATERIAL_BATCH);
      const assignment = await llm.assignMaterials(
        batch.map((m, j) => ({ index: i + j, name: m.description, unit: m.unit, section: null })),
        workRefs,
        { rules },
      );
      for (const a of assignment) widByIndex.set(a.index, a.workId);
    }
    materials.forEach((m, i) => {
      const wid = widByIndex.get(i) ?? null;
      const w = wid ? byRate.get(wid) : undefined;
      if (w) w.materials.push(m);
      else stillUnassigned.push(m);
    });
  } else {
    stillUnassigned.push(...materials);
  }

  // 7. Pass 2 — нераспределённые материалы из РД «вытягивают» недостающую работу:
  // ещё один полный обход справочника. Не-якорные материалы (крепёж/расходники/СИЗ)
  // работу не тянут. Добавленные работы и привязки идут на согласование.
  if (llm?.sweepMaterialToWork && stillUnassigned.length > 0) {
    const stop = (rules.anchorStopList ?? []).map((s) => s.toLowerCase()).filter(Boolean);
    const isAnchor = (m: ExtractedMaterial): boolean => {
      const n = m.description.toLowerCase();
      return !stop.some((s) => n.includes(s));
    };
    const anchorMats = stillUnassigned.filter(isAnchor);
    if (anchorMats.length > 0) {
      const ratesById = new Map(catalog.rates.map((e) => [e.id, e]));
      const localIndex = new Map<ExtractedMaterial, number>(anchorMats.map((m, i) => [m, i]));
      const assigned = new Map<number, string>(); // localIndex → rateId
      const inputs = anchorMats.map((m, i) => ({ index: i, name: m.description, unit: m.unit, section: null }));
      for (const chunk of chunkRatesByCostType(catalog.rates)) {
        throwIfAborted(signal);
        const remaining = inputs.filter((mi) => !assigned.has(mi.index));
        if (remaining.length === 0) break; // все привязаны — досрочный выход
        const res = await llm.sweepMaterialToWork(
          chunk.title,
          chunk.entries.map((e) => ({ id: e.id, name: e.name, unit: e.unit })),
          remaining,
          { rules },
        );
        for (const r of res) {
          if (assigned.has(r.materialIndex)) continue;
          if (chunk.entries.some((e) => e.id === r.workId)) assigned.set(r.materialIndex, r.workId);
        }
      }
      const leftover: ExtractedMaterial[] = [];
      for (const m of stillUnassigned) {
        const li = localIndex.get(m);
        const rateId = li !== undefined ? assigned.get(li) : undefined;
        const entry = rateId ? ratesById.get(rateId) : undefined;
        if (!entry) {
          leftover.push(m);
          continue;
        }
        let w = byRate.get(entry.id);
        if (!w) {
          w = pushWorkFromEntry(entry, 0.55, 'pass2_added') ?? undefined;
          if (w) byRate.set(entry.id, w);
        }
        if (!w) {
          leftover.push(m);
          continue;
        }
        // Объём работы, вытянутой материалом: при совпадении единиц — кол-во материала.
        if (w.materials.length === 0 && unitsMatch(w.unit, m.unit, rules.unitAliases)) {
          w.quantity = m.quantity;
        }
        m.reviewReason = m.reviewReason ?? 'pass2_added';
        w.materials.push(m);
        materialsSweepAssigned++;
      }
      stillUnassigned.length = 0;
      stillUnassigned.push(...leftover);
    }
  }

  // Единственная допустимая «работа» без rateId — контейнер нераспределённых материалов.
  if (stillUnassigned.length > 0) {
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
      match: { ...NO_MATCH },
      materials: stillUnassigned,
    });
  }

  const flatMaterials = works.flatMap((w) => w.materials);
  return {
    works,
    stats: {
      blocks: blocks.length,
      tables: tableCount,
      ruleItems: deduped.length - llmItemCount,
      llmItems: llmItemCount,
      works: works.length,
      materials: flatMaterials.length,
      matched: works.filter((w) => w.rateId !== null).length,
      needsReview:
        works.filter((w) => w.needsReview).length + flatMaterials.filter((m) => m.needsReview).length,
      worksFromSweep,
      materialsSweepAssigned,
    },
    anomalies,
  };
}
