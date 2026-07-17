/**
 * Административная вкладка «Задания ИИ»: задачи всех контуров в одном списке.
 *
 * Контуров три — извлечение из РД (ai_jobs), ИИ-чат (ai_chats) и умная группировка
 * (material_grouping_jobs). У каждого свои статусы и своя единица работы, поэтому наружу они
 * отдаются приведёнными к общему виду; исходный статус едет рядом (rawStatus) — админу важно
 * отличать «готово» от «применено в смету», а «зависло» от «ошибки».
 */
import { z } from 'zod';

/** Тип задачи. Значения совпадают с сегментом пути в /api/ai-tasks/:kind/:id. */
export const AI_TASK_KINDS = ['md', 'chat', 'grouping'] as const;
export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

/**
 * Приведённый статус задачи.
 * partial — только у чат-сессии: часть ходов удалась, часть упала. Показывать по последнему ходу
 * было бы враньём, а сводить такую сессию к «успеху» или «ошибке» — терять половину правды.
 */
export type AiTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'dead';

/** Строка списка задач. */
export interface AiTaskItem {
  kind: AiTaskKind;
  id: string;
  /** Готовая подпись: имя документа, заголовок чата, «Умная группировка». Собирает сервер. */
  title: string;
  /** Вторая строка подписи: источник РД, число ходов, число наборов. */
  subtitle: string | null;
  status: AiTaskStatus;
  /** Исходный статус подсистемы — в подсказке ('applied', 'ready', 'dead' и т.п.). */
  rawStatus: string;
  estimateId: string | null;
  projectName: string | null;
  /** Авторы: у чата — все участники ходов, у автогруппировки пусто (показывается «Система»). */
  users: string[];
  /** Модели в квалифицированной форме 'provider:model'; 'unknown:*' — историческая запись. */
  models: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  /** Вызовов модели: успешных и всего. Расходятся — были отказы шлюза. */
  callsOk: number;
  callsTotal: number;
  /** Сумма фактических HTTP-попыток: больше callsTotal — шлюз отвечал отказом. */
  httpAttempts: number;
  durationMs: number | null;
  /** Итог: «Р: 5 · М: 12», «6 ходов», «8 групп». */
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  /** Последняя активность: сессии сортируются по ней, а не по созданию. */
  activityAt: string;
  /** Ход без вызова модели (чат без провайдера ответил справочником) — токенов у него нет. */
  hasFallback: boolean;
}

/** Один вызов модели в журнале задачи — краткий вид, без текстов. */
export interface AiTaskCallSummary {
  id: string;
  kind: string;
  /** Ход чата, к которому относится вызов: за один ход агент зовёт модель до 8 раз. */
  turnId: string | null;
  attempt: number;
  batchIndex: number | null;
  status: 'queued' | 'waiting_slot' | 'in_progress' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'empty';
  parseStatus: 'not_run' | 'ok' | 'warnings' | 'failed';
  model: string | null;
  provider: string | null;
  httpStatus: number | null;
  httpAttempts: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  error: string | null;
  startedAt: string;
  durationMs: number | null;
  /** Тексты вычищены по сроку хранения — это не «их не было». */
  textsPurged: boolean;
  requestPreview: string | null;
  responsePreview: string | null;
}

/** Одна HTTP-попытка: у каждой свой X-Request-Id для сверки с журналом шлюза. */
export interface AiTaskHttpAttempt {
  no: number;
  requestId: string;
  status: number | null;
  /** Ожидание очереди к шлюзу: слот и щель в темпе отправок. Не работа модели. */
  waitedMs: number;
  durationMs: number;
  retryDelayMs: number | null;
  /** Сколько просил подождать сам шлюз (Retry-After); null — не просил. */
  retryAfterMs?: number | null;
  errorBody: string | null;
  networkError: string | null;
}

/** Полный текст одного вызова — грузится по клику, а не со списком. */
export interface AiTaskCallDetail extends AiTaskCallSummary {
  systemText: string | null;
  requestText: string | null;
  responseText: string | null;
  finishReason: string | null;
  attempts: AiTaskHttpAttempt[];
  parseWarnings: string[];
}

/** Ход чат-сессии: заголовок для группировки вызовов в журнале. */
export interface AiTaskTurn {
  id: string;
  createdAt: string;
  status: string;
  userName: string | null;
  /** 'fallback' — ответ без вызова модели; null — исторический ход, режим неизвестен. */
  executionMode: 'llm' | 'fallback' | null;
  prompt: string | null;
  error: string | null;
}

export interface AiTaskDetail {
  task: AiTaskItem;
  calls: AiTaskCallSummary[];
  /** Только для чата: ходы сессии по порядку. */
  turns: AiTaskTurn[];
}

export interface AiTaskStatsRow {
  key: string;
  label: string;
  tasks: number;
  succeeded: number;
  failed: number;
  promptTokens: number | null;
  completionTokens: number | null;
  calls: number;
}

export interface AiTaskStats {
  from: string;
  to: string;
  totals: {
    tasks: number;
    succeeded: number;
    failed: number;
    running: number;
    promptTokens: number | null;
    completionTokens: number | null;
    calls: number;
    callsFailed: number;
    /** Вызовы, по которым провайдер не вернул usage: расход по ним неизвестен, а не равен нулю. */
    callsWithoutUsage: number;
  };
  byKind: AiTaskStatsRow[];
  byUser: AiTaskStatsRow[];
  byModel: AiTaskStatsRow[];
}

export const aiTaskListQuerySchema = z.object({
  /** Окно выборки. Группировка ставится сама при каждой правке сметы и без окна вытеснила бы всё. */
  days: z.coerce.number().int().min(1).max(3650).optional(),
});

export const aiTaskStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(30),
});

export const aiTaskParamsSchema = z.object({
  kind: z.enum(AI_TASK_KINDS),
  id: z.string().uuid(),
});
