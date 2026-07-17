/**
 * Журнал обмена с моделью — общий для всех контуров ИИ.
 *
 * Запись создаётся ДО отправки запроса и обновляется по ходу. Это главное требование к журналу:
 * прогон идёт минутами, и запись «по факту завершения» оставила бы экран пустым ровно тогда,
 * когда админ смотрит на 0% и спрашивает, происходит ли хоть что-то.
 *
 * Сбой журнала никогда не роняет задание: наблюдение — не работа задачи. Но запись ОЖИДАЕТСЯ
 * (await), а не отправляется вдогонку: INSERT в локальную БД стоит миллисекунды против секунд на
 * вызов модели, а потерять записи при остановке процесса для аудита недопустимо.
 *
 * Родитель у записи ровно один (CHECK в 0065). Извлечение из РД и группировка цепляются к своему
 * заданию, чат — к ХОДУ (сообщению ассистента): один ход агента делает до 8 вызовов модели.
 */
import type { FastifyInstance } from 'fastify';
import type { HttpAttemptInfo } from './openrouter.js';

/** Стадия вызова. Терминальные: succeeded/failed/timed_out/cancelled/empty. */
export type CallStatus =
  | 'queued'
  | 'waiting_slot'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'empty';

/** Итог разбора ответа — ось, независимая от транспорта. */
export type ParseStatus = 'not_run' | 'ok' | 'warnings' | 'failed';

/** Этап конвейера. Список синхронизирован с CHECK ai_llm_calls_kind_check (0065). */
export type CallKind =
  | 'batch'
  | 'merge'
  | 'extract.items'
  | 'extract.match'
  | 'extract.suggest_works'
  | 'extract.assign_materials'
  | 'extract.sweep_works'
  | 'extract.sweep_material_to_work'
  | 'chat.agent'
  | 'chat.force_final';

/** К чему относится вызов. Ровно один родитель — иначе БД отвергнет запись. */
export type CallParent =
  | { kind: 'grouping'; materialGroupingJobId: string }
  | { kind: 'md'; aiJobId: string }
  | { kind: 'chat'; aiChatMessageId: string };

export interface LlmCallStart {
  parent: CallParent;
  /** Попытка ЗАДАНИЯ на момент вызова (у группировки — jobs.attempts). */
  attempt?: number;
  kind: CallKind;
  /** Специфика группировки; у остальных контуров null. */
  batchIndex?: number | null;
  partitionKey?: string | null;
  linesCount?: number | null;
  model: string;
  /** 'lmstudio' | 'openrouter' — известен в момент вызова, потом его не вывести из id модели. */
  provider?: string | null;
}

export interface LlmCallFinish {
  status: CallStatus;
  parseStatus?: ParseStatus;
  parseWarnings?: string[];
  groupsCount?: number | null;
  systemText?: string;
  requestText?: string;
  responseText?: string;
  finishReason?: string | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  attempts?: HttpAttemptInfo[];
  error?: string | null;
  durationMs?: number;
}

/**
 * Защитный предел на текст. Обычные промпты не режем: выжимка документа — 8 КБ (DIGEST_LIMIT),
 * фрагмент — 4 КБ (MAX_SNIPPET), самый большой запрос (подбор работ с 300 кандидатами) ~32 КБ.
 * Предел нужен только для нерезаного block.text распознанного чертежа, чтобы одна аномалия не
 * положила таблицу. Обрезать по 12 КБ, как предполагалось раньше, значило бы прятать ровно то,
 * ради чего журнал и заведён.
 */
const MAX_TEXT_CHARS = 1024 * 1024;
const TRUNCATION_MARK = '\n\n…[обрезано, текст превысил 1 МиБ]';

function capText(v: string | undefined): string | null {
  if (v == null) return null;
  return v.length > MAX_TEXT_CHARS ? v.slice(0, MAX_TEXT_CHARS) + TRUNCATION_MARK : v;
}

/** Последний HTTP-код из попыток: он же показывается в списке журнала. */
function lastHttpStatus(attempts: HttpAttemptInfo[] | undefined): number | null {
  if (!attempts?.length) return null;
  for (let i = attempts.length - 1; i >= 0; i--) {
    const s = attempts[i]!.status;
    if (s != null) return s;
  }
  return null;
}

/** Колонка родителя. Разложено здесь, чтобы вызывающие не знали про устройство таблицы. */
function parentColumns(p: CallParent): { grouping: string | null; job: string | null; msg: string | null } {
  return {
    grouping: p.kind === 'grouping' ? p.materialGroupingJobId : null,
    job: p.kind === 'md' ? p.aiJobId : null,
    msg: p.kind === 'chat' ? p.aiChatMessageId : null,
  };
}

/** Завести запись вызова. Возвращает id либо null — тогда обновления просто не пишутся. */
export async function startLlmCall(fastify: FastifyInstance, c: LlmCallStart): Promise<string | null> {
  const p = parentColumns(c.parent);
  try {
    const { rows } = await fastify.pool.query<{ id: string }>(
      `INSERT INTO ai_llm_calls
         (material_grouping_job_id, ai_job_id, ai_chat_message_id,
          attempt, kind, batch_index, partition_key, lines_count, model, provider, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued')
       RETURNING id`,
      [
        p.grouping,
        p.job,
        p.msg,
        c.attempt ?? 1,
        c.kind,
        c.batchIndex ?? null,
        c.partitionKey ?? null,
        c.linesCount ?? null,
        c.model,
        c.provider ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    fastify.log.warn({ err, parent: c.parent }, 'ai call log: insert failed');
    return null;
  }
}

/** Отметить стадию (ожидание слота, отправка). Тексты ещё не известны. */
export async function markLlmCall(
  fastify: FastifyInstance,
  callId: string | null,
  status: CallStatus,
): Promise<void> {
  if (!callId) return;
  await fastify.pool
    .query(`UPDATE ai_llm_calls SET status = $2 WHERE id = $1`, [callId, status])
    .catch((err) => fastify.log.warn({ err, callId }, 'ai call log: mark failed'));
}

/** Закрыть запись: итог транспорта, тексты, разбор и расход токенов. */
export async function finishLlmCall(
  fastify: FastifyInstance,
  callId: string | null,
  f: LlmCallFinish,
): Promise<void> {
  if (!callId) return;
  await fastify.pool
    .query(
      `UPDATE ai_llm_calls
          SET status = $2,
              parse_status = COALESCE($3, parse_status),
              parse_warnings = COALESCE($4::jsonb, parse_warnings),
              groups_count = $5,
              system_text = $6,
              request_text = $7,
              response_text = $8,
              finish_reason = $9,
              prompt_tokens = $10,
              completion_tokens = $11,
              total_tokens = $12,
              http_status = $13,
              http_attempts = COALESCE($14::jsonb, http_attempts),
              error = $15,
              finished_at = now(),
              duration_ms = $16
        WHERE id = $1`,
      [
        callId,
        f.status,
        f.parseStatus ?? null,
        f.parseWarnings ? JSON.stringify(f.parseWarnings) : null,
        f.groupsCount ?? null,
        capText(f.systemText),
        capText(f.requestText),
        capText(f.responseText),
        f.finishReason ?? null,
        // NULL, а не 0: «провайдер не вернул usage» и «потрачено ноль» — разные вещи, и складывать
        // их в статистике нельзя.
        f.usage?.prompt_tokens ?? null,
        f.usage?.completion_tokens ?? null,
        f.usage?.total_tokens ?? null,
        lastHttpStatus(f.attempts),
        f.attempts ? JSON.stringify(f.attempts) : null,
        f.error ?? null,
        f.durationMs ?? null,
      ],
    )
    .catch((err) => fastify.log.warn({ err, callId }, 'ai call log: finish failed'));
}

/**
 * Закрыть незавершённые записи родителя.
 *
 * Прогон могли прервать деплоем или отменой — записи так и остались бы «отправляем запрос»
 * и врали бы в журнале о вечно идущем вызове.
 */
export async function closeDanglingLlmCalls(fastify: FastifyInstance, parent: CallParent): Promise<void> {
  const p = parentColumns(parent);
  await fastify.pool
    .query(
      `UPDATE ai_llm_calls
          SET status = 'cancelled', finished_at = now(),
              error = COALESCE(error, 'Прогон прерван — результат вызова неизвестен')
        WHERE status IN ('queued', 'waiting_slot', 'in_progress')
          AND material_grouping_job_id IS NOT DISTINCT FROM $1
          AND ai_job_id IS NOT DISTINCT FROM $2
          AND ai_chat_message_id IS NOT DISTINCT FROM $3`,
      [p.grouping, p.job, p.msg],
    )
    .catch((err) => fastify.log.warn({ err, parent }, 'ai call log: dangling cleanup failed'));
}
