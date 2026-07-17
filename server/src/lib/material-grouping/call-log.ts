/**
 * Журнал обмена с моделью по заданиям группировки.
 *
 * Запись создаётся ДО отправки запроса и обновляется по ходу. Это главное требование к журналу:
 * прогон идёт минутами, и запись «по факту завершения» оставила бы экран пустым ровно тогда,
 * когда админ смотрит на 0% и спрашивает, происходит ли хоть что-то.
 *
 * Сбой журнала никогда не роняет расчёт: наблюдение — не работа задания.
 */
import type { FastifyInstance } from 'fastify';
import type { HttpAttemptInfo } from '../llm/openrouter.js';

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

export interface CallStart {
  jobId: string;
  attempt: number;
  kind: 'batch' | 'merge';
  batchIndex: number | null;
  partitionKey: string | null;
  linesCount: number | null;
  model: string;
}

export interface CallFinish {
  status: CallStatus;
  parseStatus?: ParseStatus;
  parseWarnings?: string[];
  groupsCount?: number | null;
  systemText?: string;
  requestText?: string;
  responseText?: string;
  finishReason?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  attempts?: HttpAttemptInfo[];
  error?: string | null;
  durationMs?: number;
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

/** Завести запись вызова. Возвращает id либо null — тогда обновления просто не пишутся. */
export async function startCall(fastify: FastifyInstance, c: CallStart): Promise<string | null> {
  try {
    const { rows } = await fastify.pool.query<{ id: string }>(
      `INSERT INTO material_grouping_llm_calls
         (job_id, attempt, kind, batch_index, partition_key, lines_count, model, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
       RETURNING id`,
      [c.jobId, c.attempt, c.kind, c.batchIndex, c.partitionKey, c.linesCount, c.model],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    fastify.log.warn({ err, jobId: c.jobId }, 'material grouping: call log insert failed');
    return null;
  }
}

/** Отметить стадию (ожидание слота, отправка). Тексты ещё не известны. */
export async function markCall(fastify: FastifyInstance, callId: string | null, status: CallStatus): Promise<void> {
  if (!callId) return;
  await fastify.pool
    .query(`UPDATE material_grouping_llm_calls SET status = $2 WHERE id = $1`, [callId, status])
    .catch((err) => fastify.log.warn({ err, callId }, 'material grouping: call log mark failed'));
}

/** Закрыть запись: итог транспорта, тексты, разбор и расход токенов. */
export async function finishCall(fastify: FastifyInstance, callId: string | null, f: CallFinish): Promise<void> {
  if (!callId) return;
  await fastify.pool
    .query(
      `UPDATE material_grouping_llm_calls
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
        f.systemText ?? null,
        f.requestText ?? null,
        f.responseText ?? null,
        f.finishReason ?? null,
        f.usage?.prompt_tokens ?? null,
        f.usage?.completion_tokens ?? null,
        f.usage?.total_tokens ?? null,
        lastHttpStatus(f.attempts),
        f.attempts ? JSON.stringify(f.attempts) : null,
        f.error ?? null,
        f.durationMs ?? null,
      ],
    )
    .catch((err) => fastify.log.warn({ err, callId }, 'material grouping: call log finish failed'));
}

/**
 * Закрыть незавершённые записи прошлой попытки задания.
 *
 * Прогон могли прервать деплоем или отменой — записи так и остались бы «отправляем запрос»
 * и врали бы в журнале о вечно идущем вызове.
 */
export async function closeDanglingCalls(fastify: FastifyInstance, jobId: string): Promise<void> {
  await fastify.pool
    .query(
      `UPDATE material_grouping_llm_calls
          SET status = 'cancelled', finished_at = now(),
              error = COALESCE(error, 'Прогон прерван — результат вызова неизвестен')
        WHERE job_id = $1 AND status IN ('queued', 'waiting_slot', 'in_progress')`,
      [jobId],
    )
    .catch((err) => fastify.log.warn({ err, jobId }, 'material grouping: dangling calls cleanup failed'));
}
