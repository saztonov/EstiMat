import { z } from 'zod';

/**
 * Умная группировка материалов сметы по производственным операциям.
 *
 * Модель возвращает только состав групп и признаки проверки. Количества, суммы и «Заказано»
 * клиент присоединяет из живого свода по ключу заказа — модель их не видит и менять не может.
 *
 * Результат один на смету и одинаков для всех: считается по полному объёму сметы, ставится
 * автоматически (назначение подрядчика, изменение состава), пересчитывается только админом.
 * Подрядчику ответ обрезается на сервере до его строк (lib/material-grouping/project.ts).
 */

/** Границы групп для модели. Настройка глобальная (app_settings), задаётся администратором. */
export const groupingSettingsSchema = z.object({
  /** true — материалы разных видов работ объединять нельзя. */
  costType: z.boolean(),
  location: z.boolean(),
  locationType: z.boolean(),
});
export type GroupingSettings = z.infer<typeof groupingSettingsSchema>;

/** Значение по умолчанию — то же, что привычный вид вкладки: разделять только по виду работ. */
export const DEFAULT_GROUPING_SETTINGS: GroupingSettings = {
  costType: true,
  location: false,
  locationType: false,
};

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
 * Клиент передаёт только смету: состав строк, количества и настройки сервер берёт сам —
 * иначе содержимое запроса к модели стало бы управляемым из браузера, а результат перестал бы
 * быть одинаковым для всех. Ручной запуск — это «Пересчитать» у администратора.
 */
export const createGroupingJobSchema = z.object({
  estimateId: z.string().uuid(),
  clientRequestId: z.string().uuid(),
  /** Пересчитать, даже если готовый результат с тем же входом уже есть. */
  force: z.boolean().optional(),
});
export type CreateGroupingJobInput = z.infer<typeof createGroupingJobSchema>;

/**
 * Что именно сейчас происходит с набором. Нужна, чтобы «0 из 57» не выглядели зависанием:
 * между отправкой запроса и ответом модели проходят минуты, и без этого экран молчит.
 */
export interface GroupingActivity {
  stage: 'queued' | 'waiting_slot' | 'in_progress';
  /** Номер набора (с 1) — как его видит пользователь. */
  batchNumber: number | null;
  /** Номер HTTP-попытки внутри вызова: при отказах шлюза их до 5. */
  httpAttempt: number;
  /** Последний код от шлюза, если он уже отвечал отказом. */
  lastHttpStatus: number | null;
  /** Когда эта стадия началась — клиент показывает «ждём ответ 42 с». */
  since: string;
}

/** Идущий расчёт: только прогресс, результата у него ещё нет. */
export interface GroupingProgress {
  id: string;
  status: 'pending' | 'running';
  batchesDone: number;
  batchesTotal: number;
  /** Попытка задания: при отказе шлюза их до max_attempts, и это видно на экране. */
  attempts: number;
  maxAttempts: number;
  /** Ошибка предыдущей попытки. Есть и у идущего расчёта — иначе причина повторов не видна. */
  lastError: string | null;
  /** Когда задание возьмут снова. Только для pending (ждёт ретрая). */
  nextRunAt: string | null;
  /** Текущий вызов модели. null — ни одного вызова в работе нет. */
  activity: GroupingActivity | null;
}

/** Последняя попытка, которую заслоняет прежний готовый результат. */
export interface GroupingLastAttempt {
  id: string;
  status: 'cancelled' | 'dead';
  error: string | null;
  attempts: number;
  /** true — остановлено человеком; false — исчерпаны попытки. */
  stoppedByUser: boolean;
}

/** Почему автоматического пересчёта не будет. */
export type GroupingSuppressedBy = 'manual_stop' | 'terminal_failure';

/** Один вызов модели в журнале — краткий вид (без текстов). */
export interface GroupingCallSummary {
  id: string;
  attempt: number;
  kind: 'batch' | 'merge';
  batchIndex: number | null;
  linesCount: number | null;
  status: 'queued' | 'waiting_slot' | 'in_progress' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'empty';
  parseStatus: 'not_run' | 'ok' | 'warnings' | 'failed';
  groupsCount: number | null;
  httpStatus: number | null;
  /** Сколько фактических HTTP-попыток понадобилось. */
  httpAttempts: number;
  totalTokens: number | null;
  error: string | null;
  startedAt: string;
  durationMs: number | null;
}

/** Одна HTTP-попытка вызова: у каждой свой X-Request-Id для сверки с журналом шлюза. */
export interface GroupingCallHttpAttempt {
  no: number;
  requestId: string;
  status: number | null;
  /** Ожидание свободного слота шлюза. Отделено от времени запроса: это очередь, а не модель. */
  waitedMs?: number;
  durationMs: number;
  retryDelayMs: number | null;
  errorBody: string | null;
  networkError: string | null;
}

/** Полный вызов: то, что реально ушло в модель, и то, что она ответила. */
export interface GroupingCallDetail extends GroupingCallSummary {
  model: string | null;
  finishReason: string | null;
  partitionKey: string | null;
  systemText: string | null;
  requestText: string | null;
  responseText: string | null;
  parseWarnings: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  attemptsLog: GroupingCallHttpAttempt[];
}

/** Шапка журнала: состояние задания целиком. */
export interface GroupingCallsResponse {
  job: {
    id: string;
    status: GroupingJobStatus;
    model: string | null;
    promptVersion: string | null;
    attempts: number;
    maxAttempts: number;
    batchesDone: number;
    batchesTotal: number;
    error: string | null;
    nextRunAt: string | null;
    createdAt: string;
  };
  data: GroupingCallSummary[];
}

/**
 * Ответ GET /jobs/latest.
 *
 * `data` — последний ГОТОВЫЙ результат, если он есть (иначе последнее задание). Пересчёт идёт
 * 10–25 минут, и на это время экран не должен пустеть: старый результат остаётся видимым, а о
 * пересчёте сообщает `active`.
 * `active` — идущий расчёт (может соседствовать с готовым `data`).
 * `available` — настроен ли ИИ-провайдер (готовый результат отдаётся и без него).
 * `stale` — вход сметы изменился после расчёта; считает сервер по input_hash (клиент сам этого
 * знать не может: у подрядчика на руках только его часть строк).
 * `lastAttempt` — отменённая или мёртвая попытка, которую заслоняет прежний `ready`.
 * `autoRunSuppressed` — почему пересчёта не будет: пока он не null, обещать автоматический
 * пересчёт нельзя.
 * `nextAutoRunAt` — пересчёт БУДЕТ, но не раньше этого момента (прошлый прогон слишком свежий).
 * С `autoRunSuppressed` не смешивать: там «не будет вовсе, нужна рука».
 */
export interface LatestGroupingJobResponse {
  data: GroupingJob | null;
  active: GroupingProgress | null;
  available: boolean;
  stale: boolean;
  lastAttempt: GroupingLastAttempt | null;
  autoRunSuppressed: GroupingSuppressedBy | null;
  nextAutoRunAt: string | null;
}
