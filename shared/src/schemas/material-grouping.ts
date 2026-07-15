import { z } from 'zod';

/**
 * Умная группировка материалов сметы по производственным операциям.
 *
 * Модель возвращает только состав групп и признаки проверки. Количества, суммы и «Заказано»
 * клиент присоединяет из живого свода по ключу заказа — модель их не видит и менять не может.
 */

export const groupingSettingsSchema = z.object({
  /** true — материалы разных видов работ объединять нельзя. */
  costType: z.boolean(),
  location: z.boolean(),
  locationType: z.boolean(),
});
export type GroupingSettings = z.infer<typeof groupingSettingsSchema>;

/**
 * Две независимые оси вместо одного статуса: «комплект неполон» и «есть возможная
 * несостыковка» — разные вопросы, и группа может отвечать на них по-разному.
 * Подписи ТЗ («Требуется проверка», «Ошибок не обнаружено») выводятся из пары.
 */
export const COMPLETENESS = ['complete', 'incomplete', 'unknown'] as const;
export const COMPATIBILITY = ['no_issues', 'possible_issue', 'unknown'] as const;
export type Completeness = (typeof COMPLETENESS)[number];
export type Compatibility = (typeof COMPATIBILITY)[number];

export const groupIssueSchema = z.object({
  severity: z.enum(['warning', 'review', 'recommendation']),
  message: z.string(),
  /** Ключи заказа строк, к которым относится замечание. */
  orderKeys: z.array(z.string()).default([]),
});
export type GroupIssue = z.infer<typeof groupIssueSchema>;

export const missingComponentSchema = z.object({
  name: z.string(),
  reason: z.string(),
  /** Рекомендация сметчику проверить. В заявку не добавляется. */
  need: z.enum(['required', 'conditional', 'recommended']),
});

export const materialGroupSchema = z.object({
  id: z.string(),
  /** Производственная операция: «Армирование плиты перекрытия». */
  name: z.string(),
  purpose: z.string().nullable(),
  completeness: z.enum(COMPLETENESS),
  compatibility: z.enum(COMPATIBILITY),
  /** Ключи заказа входящих строк. */
  orderKeys: z.array(z.string()),
  issues: z.array(groupIssueSchema).default([]),
  missing: z.array(missingComponentSchema).default([]),
});
export type MaterialGroupDto = z.infer<typeof materialGroupSchema>;

export const groupingResultSchema = z.object({
  groups: z.array(materialGroupSchema),
  /** Расходники, общие для нескольких операций. */
  sharedKeys: z.array(z.string()).default([]),
  /** Строки, которые не удалось отнести к операции (в т.ч. отброшенные при валидации). */
  ungroupedKeys: z.array(z.string()).default([]),
  stats: z.object({
    batches: z.number(),
    groups: z.number(),
    /** covered + shared + ungrouped = total. Считает сервер, не модель. */
    covered: z.number(),
    shared: z.number(),
    ungrouped: z.number(),
    total: z.number(),
  }),
});
export type GroupingResult = z.infer<typeof groupingResultSchema>;

export const GROUPING_JOB_STATUSES = ['pending', 'running', 'ready', 'failed', 'cancelled', 'dead'] as const;
export type GroupingJobStatus = (typeof GROUPING_JOB_STATUSES)[number];

export const groupingJobSchema = z.object({
  id: z.string().uuid(),
  estimateId: z.string().uuid(),
  status: z.enum(GROUPING_JOB_STATUSES),
  settings: groupingSettingsSchema,
  inputHash: z.string(),
  batchesTotal: z.number(),
  batchesDone: z.number(),
  result: groupingResultSchema.nullable(),
  warnings: z.array(z.string()).default([]),
  error: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GroupingJob = z.infer<typeof groupingJobSchema>;

/**
 * Клиент передаёт только область и настройки: состав строк, названия и количества сервер
 * собирает из БД сам — иначе содержимое запроса к модели стало бы управляемым из браузера.
 */
export const createGroupingJobSchema = z.object({
  estimateId: z.string().uuid(),
  /** Отбор по подрядчикам (только для сотрудников). */
  contractorIds: z.array(z.string().uuid()).optional(),
  settings: groupingSettingsSchema,
  clientRequestId: z.string().uuid(),
  /** Пересчитать, даже если готовый результат с тем же входом уже есть. */
  force: z.boolean().optional(),
});
export type CreateGroupingJobInput = z.infer<typeof createGroupingJobSchema>;
