/**
 * Контракты ядра извлечения работ/материалов из рабочей документации (РД).
 *
 * Ядро — ЧИСТЫЕ модули: не импортируют fastify / pg / config. Все внешние
 * зависимости (чтение справочников, вызов LLM, запись в БД) инъектируются.
 * Один и тот же код используется и skill-раннером (фаза 1, LLM через файловый
 * обмен), и будущим Fastify-маршрутом (фаза 2, LLM через OpenRouter).
 */

// ============================================================
// Разбор markdown
// ============================================================

/** Блок распознанного markdown документа РД. */
export type RawBlock =
  | { type: 'heading'; level: number; text: string; line: number }
  | {
      type: 'table';
      headers: string[];
      rows: string[][];
      /** Путь заголовков секции над таблицей (от верхнего к нижнему). */
      sectionPath: string[];
      sourceSnippet: string;
      startLine: number;
    }
  | {
      type: 'paragraph';
      text: string;
      sectionPath: string[];
      sourceSnippet: string;
      line: number;
    };

// ============================================================
// Извлечённые позиции
// ============================================================

/** Что за позиция: работа, материал или оборудование. */
export type SpecKind = 'work' | 'material' | 'equipment';

/**
 * Сырая позиция спецификации (по образцу DocuSpec MaterialFactItem).
 * Поля заполняются rule-based стадиями или LLM; привязка к справочнику — позже.
 */
export interface RawSpecItem {
  /** Точное наименование из документа. */
  rawName: string;
  /** Родитель-конструкция/раздел (например, «ОГ-13», «Узел учёта»). */
  construction: string | null;
  quantity: number | null;
  unit: string | null;
  /** Позиция/маркировка (Поз.). */
  mark: string | null;
  /** Ссылка на ГОСТ/ТУ, если найдена. */
  gost: string | null;
  /** Точная цитата из документа (для аудита/трассировки). */
  sourceSnippet: string;
  kind: SpecKind;
  /** 0..1 — уверенность извлечения. */
  confidence: number;
  /** Путь секции, в которой найдена позиция. */
  sectionPath: string[];
}

// ============================================================
// Справочники (срез из БД, передаётся в ядро как данные)
// ============================================================

/** Запись справочника (работа или материал, v2 или legacy). */
export interface CatalogEntry {
  id: string;
  name: string;
  unit: string | null;
  /** Цена из выбранного настройкой справочника (может быть null). */
  price: number | null;
  /** Синонимы (rates_v2.aliases / materials_v2.aliases). */
  aliases: string[];
  costTypeId: string | null;
  /** Из какого справочника пришла запись. */
  source: 'v2' | 'legacy';
}

/** Откуда брать справочник для сопоставления (настройка в Администрировании). */
export type CatalogSourceMode = 'v2_first' | 'legacy' | 'both';

export interface CatalogSnapshot {
  rates: CatalogEntry[];
  materials: CatalogEntry[];
  mode: CatalogSourceMode;
}

// ============================================================
// Сопоставление со справочником
// ============================================================

export type MatchVia = 'exact' | 'alias' | 'fuzzy' | 'llm' | 'none';
export type MatchDecision = 'matched' | 'probable' | 'unmatched';

export interface MatchResult {
  /** id записи справочника (rates/rates_v2 или material_catalog/materials_v2). */
  catalogId: string | null;
  matchedName: string | null;
  /** Подставленная цена из справочника (если есть). */
  unitPrice: number | null;
  /** Подставленная единица из справочника (если совпала). */
  unit: string | null;
  costTypeId: string | null;
  decision: MatchDecision;
  via: MatchVia;
  confidence: number;
}

// ============================================================
// Результат извлечения (пишется в ai_jobs.result, применяется apply.ts)
// ============================================================

export interface ExtractedMaterial {
  description: string;
  materialId: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  confidence: number;
  needsReview: boolean;
  sourceSnippet: string | null;
  match: MatchResult;
}

export interface ExtractedWork {
  description: string;
  rateId: string | null;
  costTypeId: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  confidence: number;
  needsReview: boolean;
  sourceSnippet: string | null;
  match: MatchResult;
  materials: ExtractedMaterial[];
}

export interface ExtractionStats {
  blocks: number;
  tables: number;
  ruleItems: number;
  llmItems: number;
  works: number;
  materials: number;
  matched: number;
  needsReview: number;
}

export interface ExtractionResult {
  works: ExtractedWork[];
  stats: ExtractionStats;
  /** Аномалии/замечания для отчёта (не теряем ни одной строки молча). */
  anomalies: string[];
}

// ============================================================
// Накопленные правила (scripts/ai-extract/rules.json)
// ============================================================

export interface ExtractRules {
  /** Синонимы заголовков колонок → каноническая роль (name/qty/unit/mark/gost). */
  columnAliases?: Record<string, string[]>;
  /** Подсказки классификатору: подстрока заголовка секции/таблицы → тип таблицы. */
  tableTypeHints?: Record<string, string>;
  /** Раздел РД (подстрока) → типовая работа (наименование для матчинга). */
  sectionToWork?: Record<string, string>;
  /** Нормализация единиц измерения: вариант → канон. */
  unitAliases?: Record<string, string>;
  /** Синонимы материалов: вариант → канон. */
  materialSynonyms?: Record<string, string>;
  /** Уроки формата РД (текстовые заметки для LLM-агентов). */
  lessons?: string[];
}

// ============================================================
// Порт LLM (реализуется по-разному в фазе 1 и фазе 2)
// ============================================================

export interface LlmExtractContext {
  sectionPath: string[];
  rules: ExtractRules;
}

export interface LlmMatchCandidate {
  id: string;
  name: string;
  unit: string | null;
}

/**
 * Порт LLM. Если не передан в pipeline — LLM-стадии пропускаются (чистый
 * rule-based прогон). Реализации: файловый обмен (skill) и OpenRouter (фаза 2).
 */
export interface LlmPort {
  /** Извлечь позиции из неразобранного rule-based блока (проза/слитая таблица). */
  extractItems(blockText: string, ctx: LlmExtractContext): Promise<RawSpecItem[]>;
  /** Выбрать лучшего кандидата справочника для позиции (или null). */
  matchCandidate(
    item: RawSpecItem,
    candidates: LlmMatchCandidate[],
  ): Promise<{ id: string; confidence: number } | null>;
}
