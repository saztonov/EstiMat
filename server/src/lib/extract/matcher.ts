/**
 * Сопоставление извлечённой позиции со справочником.
 *  - Уровень 1 (0 токенов): exact по имени → alias → нечёткое (триграммы) + unit.
 *  - Уровень 2 (LLM, опционально): выбор из top-N кандидатов для остатка.
 * Цена/единица берутся из записи справочника (entry.price/entry.unit), которую
 * catalog-source уже сформировал согласно настройке источника.
 */
import type {
  CatalogEntry,
  MatchResult,
  RawSpecItem,
  ExtractRules,
  LlmPort,
  LlmMatchCandidate,
} from './types.js';
import { norm, trigramSimilarity, unitsMatch } from './normalize.js';

const FUZZY_MATCHED = 0.85; // ≥ — считаем точным
const FUZZY_PROBABLE = 0.62; // ≥ — вероятный кандидат
const CANDIDATE_LIMIT = 8;

const NO_MATCH: MatchResult = {
  catalogId: null,
  matchedName: null,
  unitPrice: null,
  unit: null,
  costTypeId: null,
  decision: 'unmatched',
  via: 'none',
  confidence: 0,
};

function applySynonym(name: string, synonyms: Record<string, string>): string {
  const n = norm(name);
  return synonyms[n] ?? name;
}

function result(
  entry: CatalogEntry,
  via: MatchResult['via'],
  decision: MatchResult['decision'],
  confidence: number,
  itemUnit: string | null,
  unitAliases: Record<string, string>,
): MatchResult {
  const unitOk = unitsMatch(itemUnit, entry.unit, unitAliases);
  return {
    catalogId: entry.id,
    matchedName: entry.name,
    unitPrice: entry.price,
    // Подставляем единицу справочника, только если она согласуется (или у позиции её нет).
    unit: unitOk || !itemUnit ? entry.unit : itemUnit,
    costTypeId: entry.costTypeId,
    decision,
    via,
    confidence,
  };
}

/** Top-N кандидатов по триграммной близости (для LLM-уровня). */
export function topCandidates(
  name: string,
  entries: CatalogEntry[],
  limit = CANDIDATE_LIMIT,
): { entry: CatalogEntry; score: number }[] {
  return entries
    .map((entry) => {
      const names = [entry.name, ...entry.aliases];
      const score = Math.max(...names.map((n) => trigramSimilarity(name, n)));
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Уровень 1: rule-based матчинг. */
export function matchRuleBased(
  item: RawSpecItem,
  entries: CatalogEntry[],
  rules: ExtractRules = {},
): MatchResult {
  if (entries.length === 0) return NO_MATCH;
  const unitAliases = rules.unitAliases ?? {};
  const name = applySynonym(item.rawName, rules.materialSynonyms ?? {});
  const target = norm(name);

  // 1. Точное совпадение по имени (первое — v2 идёт раньше legacy).
  const exact = entries.find((e) => norm(e.name) === target);
  if (exact) return result(exact, 'exact', 'matched', 1, item.unit, unitAliases);

  // 2. Совпадение по алиасу.
  const byAlias = entries.find((e) => e.aliases.some((a) => norm(a) === target));
  if (byAlias) return result(byAlias, 'alias', 'matched', 0.95, item.unit, unitAliases);

  // 3. Нечёткое совпадение + согласование единицы.
  const [best] = topCandidates(name, entries, 1);
  if (best) {
    const unitOk = unitsMatch(item.unit, best.entry.unit, unitAliases) || !item.unit;
    if (best.score >= FUZZY_MATCHED && unitOk) {
      return result(best.entry, 'fuzzy', 'matched', best.score, item.unit, unitAliases);
    }
    if (best.score >= FUZZY_PROBABLE) {
      return result(best.entry, 'fuzzy', 'probable', best.score, item.unit, unitAliases);
    }
  }

  return NO_MATCH;
}

/**
 * Полный матчинг: уровень 1, затем (если не точное совпадение и есть LLM-порт)
 * уровень 2 — выбор из top-N кандидатов.
 */
export async function matchItem(
  item: RawSpecItem,
  entries: CatalogEntry[],
  rules: ExtractRules = {},
  llm?: LlmPort,
): Promise<MatchResult> {
  const ruleMatch = matchRuleBased(item, entries, rules);
  if (ruleMatch.decision === 'matched' || !llm || entries.length === 0) return ruleMatch;

  const unitAliases = rules.unitAliases ?? {};
  const candidates = topCandidates(item.rawName, entries, CANDIDATE_LIMIT).filter((c) => c.score > 0.1);
  if (candidates.length === 0) return ruleMatch;

  const dto: LlmMatchCandidate[] = candidates.map((c) => ({
    id: c.entry.id,
    name: c.entry.name,
    unit: c.entry.unit,
  }));
  const picked = await llm.matchCandidate(item, dto);
  if (!picked) return ruleMatch;

  const entry = entries.find((e) => e.id === picked.id);
  if (!entry) return ruleMatch;

  const decision: MatchResult['decision'] = picked.confidence >= 0.8 ? 'matched' : 'probable';
  return result(entry, 'llm', decision, picked.confidence, item.unit, unitAliases);
}
