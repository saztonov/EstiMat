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
      /** Параграф — распознанный текст блока-изображения (поле «Текст на чертеже»). */
      isDrawingText?: boolean;
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
  /** Раздел (cost_categories.name) — для группировки чанков обхода. */
  categoryName?: string | null;
  /** Вид затрат (cost_types.name) — заголовок чанка обхода. */
  costTypeName?: string | null;
  /** Композитный порядок «фундамент → отделка» (cat.sort, type.sort, rate). */
  sortKey?: number;
}

/** Откуда брать справочник для сопоставления (настройка в Администрировании). */
export type CatalogSourceMode = 'v2_first' | 'legacy' | 'both';

/**
 * Область подбора работ, заданная сметчиком в фильтрах. Сужает справочник РАБОТ
 * (rates) при загрузке среза: если costTypeIds непуст — по видам, иначе по
 * разделам (categoryIds). Материалы областью не сужаются.
 */
export interface SectionScope {
  /** cost_categories.id — выбранные разделы (≥1). */
  categoryIds: string[];
  /** cost_types.id — выбранные виды (опц.; пусто = все виды выбранных разделов). */
  costTypeIds: string[];
}

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

/** Причина пометки needs_review (для очереди разбора сметчиком). */
export type ReviewReason = 'pass1_context' | 'pass2_added' | 'qty_unknown';

export interface ExtractedMaterial {
  description: string;
  materialId: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  confidence: number;
  needsReview: boolean;
  reviewReason?: ReviewReason;
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
  reviewReason?: ReviewReason;
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
  /** Работ добавлено полным обходом справочника (Pass 1). */
  worksFromSweep?: number;
  /** Материалов, «вытянувших» работу обходом по нераспределённому пулу (Pass 2). */
  materialsSweepAssigned?: number;
}

export interface ExtractionResult {
  works: ExtractedWork[];
  stats: ExtractionStats;
  /** Аномалии/замечания для отчёта (не теряем ни одной строки молча). */
  anomalies: string[];
}

/**
 * Системный контейнер для материалов, которые ИИ не смог отнести к конкретной
 * подобранной работе. Единственная допустимая «работа» без rateId — apply.ts
 * пропускает только её, остальные работы без справочной привязки отбрасывает.
 */
export const MATERIALS_BUCKET = 'Материалы из РД (распределить)';

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
  /**
   * Не-якорные материалы (крепёж/расходники/СИЗ): подстроки наименований, которые
   * НЕ должны «вытягивать» работу в Pass 2 (сопровождают любую работу).
   */
  anchorStopList?: string[];
  /** Уроки формата РД (текстовые заметки для LLM-агентов). */
  lessons?: string[];
}

// ============================================================
// Порт LLM (реализуется по-разному в фазе 1 и фазе 2)
// ============================================================

export interface LlmExtractContext {
  sectionPath: string[];
  rules: ExtractRules;
  /** Тип фрагмента: проза или распознанный текст чертежа (строчная спецификация). */
  kind?: 'prose' | 'drawing';
}

export interface LlmMatchCandidate {
  id: string;
  name: string;
  unit: string | null;
}

/** Контекст подбора работ из суженного справочника по содержанию документа. */
export interface LlmSuggestWorksContext {
  scope: SectionScope;
  rules: ExtractRules;
}

/** Работа, предложенная LLM из списка кандидатов (id — rate из candidates). */
export interface LlmSuggestedWork {
  id: string;
  confidence: number;
}

/** Материал для распределения по работам. */
export interface LlmMaterialInput {
  index: number;
  name: string;
  unit: string | null;
  section: string | null;
}

/** Ссылка на подобранную работу (id = rateId справочника). */
export interface LlmWorkRef {
  id: string;
  name: string;
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
  /**
   * Гибридный подбор работ: из списка кандидатов (суженный по scope справочник
   * расценок) выбрать работы, нужные для систем/решений, описанных в документе.
   * Не выдумывать работ вне списка. Возвращает выбранные id с уверенностью.
   */
  suggestWorks(
    documentDigest: string,
    candidates: LlmMatchCandidate[],
    ctx: LlmSuggestWorksContext,
  ): Promise<LlmSuggestedWork[]>;
  /**
   * Распределить материалы по подобранным работам (сметчик): каждому материалу —
   * наиболее подходящая работа из списка (id) либо null (нет подходящей).
   */
  assignMaterials(
    materials: LlmMaterialInput[],
    works: LlmWorkRef[],
    ctx: { rules: ExtractRules },
  ): Promise<{ index: number; workId: string | null }[]>;
  /**
   * Pass 1 — систематический обход справочника. Для ОДНОГО раздела-чанка работ
   * (один вид затрат) выбрать работы, реально применимые к данному РД (по выжимке
   * документа и списку извлечённых материалов). Возвращает id ТОЛЬКО из chunk.
   * Опционально: порт без метода → pipeline идёт по fallback-пути suggestWorks.
   */
  sweepWorks?(
    chunkTitle: string,
    chunk: LlmMatchCandidate[],
    documentDigest: string,
    materials: string[],
    ctx: LlmSuggestWorksContext,
  ): Promise<LlmSuggestedWork[]>;
  /**
   * Pass 2 — обход справочника по нераспределённым материалам. Для ОДНОГО чанка
   * работ вернуть привязки {materialIndex, workId} для материалов, относящихся по
   * смыслу к работе чанка. Материал без привязки в ответе не упоминается.
   */
  sweepMaterialToWork?(
    chunkTitle: string,
    chunk: LlmMatchCandidate[],
    materials: LlmMaterialInput[],
    ctx: { rules: ExtractRules },
  ): Promise<{ materialIndex: number; workId: string }[]>;
}
