import { z } from 'zod';
import { sectionScopeSchema } from './ai.js';
import { locationContextSchema } from './location.js';

// ============================================================
// ИИ-ассистент сметчика в режиме «Чат».
//   * Сессии (ai_chats) и сообщения (ai_chat_messages).
//   * Сообщение ассистента несёт шаги агента (steps) и карточки-предложения (cards).
//   * Запись в смету — только через /apply: клиент шлёт минимум (source/catalogId/
//     quantity/flags), сервер заново грузит canonical из БД.
// ============================================================

/** Источник позиции в справочнике: новый (ВОР) или старый каталог. */
export const catalogSourceKindSchema = z.enum(['v2', 'legacy']);

// ---------- Карточки-предложения ----------

/** Кандидат-работа из справочника. */
export const workCandidateSchema = z.object({
  source: catalogSourceKindSchema,
  /** id записи в справочнике (rates_v2.id или rates.id). */
  catalogId: z.string().uuid(),
  /** legacy rate_id для вставки в estimate_items.rate_id (может быть null для v2 без legacy). */
  applyRateId: z.string().uuid().nullable(),
  name: z.string(),
  costTypeId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  costTypeName: z.string().nullable(),
  unit: z.string().nullable(),
  price: z.number(),
  confidence: z.number(),
  /** id уже существующей в смете работы-дубля (если найден). */
  duplicateOfItemId: z.string().uuid().nullable(),
  typicalMaterialsCount: z.number(),
});

/** Кандидат-материал из справочника. */
export const materialCandidateSchema = z.object({
  source: catalogSourceKindSchema,
  /** id записи (materials_v2.id или material_catalog.id). */
  catalogId: z.string().uuid(),
  /** legacy material_id для estimate_materials.material_id (может быть null для v2 без legacy). */
  applyMaterialId: z.string().uuid().nullable(),
  name: z.string(),
  unit: z.string().nullable(),
  price: z.number(),
  confidence: z.number(),
  duplicateOfItemId: z.string().uuid().nullable(),
});

/** Похожая работа из сметы другого объекта. */
export const similarWorkSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unitPrice: z.number(),
  /** legacy rate_id исходной позиции (если был) — нужен, чтобы добавить к себе. */
  rateId: z.string().uuid().nullable(),
  projectCode: z.string().nullable(),
  projectName: z.string().nullable(),
  estimateId: z.string().uuid(),
  similarity: z.number(),
});

/** Похожий материал из сметы другого объекта. */
export const similarMaterialSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unitPrice: z.number(),
  materialId: z.string().uuid().nullable(),
  parentWorkDescription: z.string().nullable(),
  projectCode: z.string().nullable(),
  projectName: z.string().nullable(),
  estimateId: z.string().uuid(),
  similarity: z.number(),
});

/** Карточка-предложение в сообщении ассистента (discriminated union по type). */
export const chatCardSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('work_candidates'),
    title: z.string().nullable().optional(),
    items: z.array(workCandidateSchema),
  }),
  z.object({
    type: z.literal('material_candidates'),
    title: z.string().nullable().optional(),
    /** Работа сметы, к которой предлагается добавить материалы (если есть). */
    targetItemId: z.string().uuid().nullable().optional(),
    items: z.array(materialCandidateSchema),
  }),
  z.object({
    type: z.literal('similar_works'),
    title: z.string().nullable().optional(),
    items: z.array(similarWorkSchema),
  }),
  z.object({
    type: z.literal('similar_materials'),
    title: z.string().nullable().optional(),
    items: z.array(similarMaterialSchema),
  }),
  z.object({
    type: z.literal('section_preview'),
    title: z.string().nullable().optional(),
    sourceEstimateId: z.string().uuid(),
    costTypeId: z.string().uuid(),
    works: z.array(similarWorkSchema),
  }),
  z.object({
    type: z.literal('calc'),
    label: z.string(),
    value: z.number(),
    unit: z.string(),
    formula: z.string(),
  }),
]);

// ---------- Шаги агента (для отображения хода работы) ----------

export const chatStepKindSchema = z.enum([
  'search_works',
  'search_materials',
  'typical_materials',
  'similar_works',
  'similar_materials',
  'estimate_context',
  'list_categories',
  'estimate_quantity',
  'section_preview',
]);

export const chatStepStatusSchema = z.enum(['running', 'ok', 'error']);

export const chatStepSchema = z.object({
  id: z.string(),
  kind: chatStepKindSchema,
  status: chatStepStatusSchema,
  label: z.string(),
  query: z.string().nullable().optional(),
  resultCount: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
});

// ---------- Сообщения и сессии ----------

export const chatRoleSchema = z.enum(['user', 'assistant']);
export const chatMessageStatusSchema = z.enum(['running', 'done', 'failed', 'cancelled']);

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  role: chatRoleSchema,
  status: chatMessageStatusSchema,
  content: z.string().nullable(),
  model: z.string().nullable(),
  steps: z.array(chatStepSchema),
  cards: z.array(chatCardSchema),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const chatSessionStatusSchema = z.enum(['active', 'archived']);

export const chatSessionSchema = z.object({
  id: z.string().uuid(),
  estimateId: z.string().uuid(),
  title: z.string().nullable(),
  status: chatSessionStatusSchema,
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ---------- Запросы ----------

export const createChatSessionSchema = z.object({
  estimateId: z.string().uuid(),
});

export const sendChatMessageSchema = z.object({
  content: z.string().min(1, 'Сообщение пустое').max(4000, 'Слишком длинное сообщение'),
  /** Область подбора (разделы/виды), выбранная в чате. Сужает поиск по справочнику. */
  sectionScope: sectionScopeSchema.optional(),
});

/**
 * Применение выбранных позиций. Клиент передаёт ТОЛЬКО ссылки и количества —
 * сервер заново грузит canonical (имя/единицу/цену/cost_type) из БД.
 */
export const applyItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('work'),
    source: catalogSourceKindSchema,
    catalogId: z.string().uuid(),
    quantity: z.number().positive(),
    addTypicalMaterials: z.boolean().default(false),
    // Контекст локации из UI (опционально): куда добавить работу. Материал наследует от targetItemId.
    ...locationContextSchema.shape,
  }),
  z.object({
    kind: z.literal('material'),
    source: catalogSourceKindSchema,
    catalogId: z.string().uuid(),
    quantity: z.number().positive(),
    /** Работа сметы, к которой добавляется материал. */
    targetItemId: z.string().uuid(),
  }),
]);

export const aiChatApplySchema = z.object({
  chatId: z.string().uuid(),
  items: z.array(applyItemSchema).min(1).max(50),
  override: z.boolean().default(false),
});

export const applySectionSchema = z.object({
  chatId: z.string().uuid(),
  sourceEstimateId: z.string().uuid(),
  costTypeId: z.string().uuid(),
  override: z.boolean().default(false),
});

export const applyResultSchema = z.object({
  added: z.object({ works: z.number(), materials: z.number() }),
  addedItemIds: z.array(z.string().uuid()),
  skipped: z.array(z.object({ catalogId: z.string(), reason: z.string() })),
});

// ---------- Типы ----------

export type CatalogSourceKind = z.infer<typeof catalogSourceKindSchema>;
export type WorkCandidate = z.infer<typeof workCandidateSchema>;
export type MaterialCandidate = z.infer<typeof materialCandidateSchema>;
export type SimilarWork = z.infer<typeof similarWorkSchema>;
export type SimilarMaterial = z.infer<typeof similarMaterialSchema>;
export type ChatCard = z.infer<typeof chatCardSchema>;
export type ChatStep = z.infer<typeof chatStepSchema>;
export type ChatStepKind = z.infer<typeof chatStepKindSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatMessageStatus = z.infer<typeof chatMessageStatusSchema>;
export type ChatSession = z.infer<typeof chatSessionSchema>;
export type CreateChatSessionInput = z.infer<typeof createChatSessionSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type ApplyItem = z.infer<typeof applyItemSchema>;
export type AiChatApplyInput = z.infer<typeof aiChatApplySchema>;
export type ApplySectionInput = z.infer<typeof applySectionSchema>;
export type ApplyResult = z.infer<typeof applyResultSchema>;
