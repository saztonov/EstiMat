/**
 * Раннер заданий группировки.
 *
 * Устройство — по корпоративному стандарту v3.1 (раздел 16): захват задачи атомарным UPDATE,
 * heartbeat через locked_until, checkpoint после каждого набора, ретраи с backoff и jitter,
 * dead-state после max_attempts. На LM Studio смета в 577 позиций считается 10–25 минут, и
 * прогон обязан пережить деплой: после перезапуска задание продолжается с последнего набора,
 * а не считается заново.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { GroupingSettings } from '@estimat/shared';
import { loadLlmRuntime, resolveLlmEndpoint } from '../llm/endpoint.js';
import { withLmStudioSlot } from '../llm/limiter.js';
import { resolveAiModel, resolveQwenNoThink } from '../llm/settings.js';
import { resolvePrompt } from '../llm/prompts.js';
import { chatJsonOnce } from '../llm/chat-json.js';
import { loadGroupingLines, type LoadScope } from './input.js';
import { planBatches, partitionsNeedingMerge } from './batch.js';
import { buildSystemPrompt, buildBatchUserPrompt, buildMergeUserPrompt } from './prompt.js';
import { parseBatchResponse, parseMergeResponse } from './parse.js';
import { assembleResult, type MergeOp } from './assemble.js';
import type { DraftBatch, GroupingBatch } from './types.js';

/** Идентификатор процесса-исполнителя: чей это захват. */
const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

const LOCK_TTL_MS = 5 * 60_000;
/** Продлеваем блокировку после каждого набора: живое задание не должен подобрать watchdog. */
const HEARTBEAT_MS = LOCK_TTL_MS;
const BATCH_TIMEOUT_LM_MS = 240_000;
const BATCH_TIMEOUT_OR_MS = 90_000;
/** Внутренние ретраи chatWithTools съедают до ~46 с только на sleep — таймаут меньше минуты ловил бы их. */
const MERGE_TIMEOUT_MS = 90_000;
const JOB_DEADLINE_LM_MS = 40 * 60_000;
const JOB_DEADLINE_OR_MS = 8 * 60_000;
const OR_PARALLEL = 4;

const runningJobs = new Map<string, AbortController>();

/** Остановить выполняющееся задание этого процесса. */
export function abortGroupingJob(jobId: string): void {
  runningJobs.get(jobId)?.abort();
}

/** Снимок промптов/режима, зафиксированный при создании задания (см. routes/material-grouping). */
interface JobSnapshot {
  groupingSystem?: string;
  groupingMerge?: string;
  model?: string;
  noThink?: boolean;
}

interface JobRow {
  id: string;
  estimate_id: string;
  scope_org_id: string | null;
  payload: { contractorIds?: string[]; snapshot?: JobSnapshot };
  settings: GroupingSettings;
  attempts: number;
  max_attempts: number;
  checkpoint: { batches?: Record<string, DraftBatch>; merges?: MergeOp[] };
}

/** Backoff с jitter (стандарт): без разброса все упавшие задания ретраятся синхронно. */
function nextRunDelaySec(attempt: number): number {
  const base = Math.min(300, 30 * 2 ** attempt);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

/**
 * Захватить задание. Атомарный UPDATE вместо реестра в памяти: после перезапуска процесса
 * задание должен подобрать новый исполнитель, а два исполнителя одновременно — не должны.
 */
async function claim(fastify: FastifyInstance, jobId: string): Promise<JobRow | null> {
  const { rows } = await fastify.pool.query<JobRow>(
    `UPDATE material_grouping_jobs
        SET status = 'running',
            locked_by = $2,
            locked_until = now() + ($3 || ' milliseconds')::interval,
            attempts = attempts + 1
      WHERE id = $1
        AND status IN ('pending', 'running')
        AND next_run_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      RETURNING id, estimate_id, scope_org_id, payload, settings, attempts, max_attempts, checkpoint`,
    [jobId, WORKER_ID, String(LOCK_TTL_MS)],
  );
  return rows[0] ?? null;
}

/** Прогресс + продление блокировки + checkpoint одним UPDATE: живое задание не заберёт watchdog. */
async function heartbeat(
  fastify: FastifyInstance,
  jobId: string,
  done: number,
  checkpoint: { batches: Record<string, DraftBatch>; merges: MergeOp[] },
): Promise<void> {
  await fastify.pool
    .query(
      `UPDATE material_grouping_jobs
          SET batches_done = $2,
              checkpoint = $3::jsonb,
              locked_until = now() + ($4 || ' milliseconds')::interval
        WHERE id = $1 AND locked_by = $5`,
      [jobId, done, JSON.stringify(checkpoint), String(HEARTBEAT_MS), WORKER_ID],
    )
    .catch(() => {});
}

/** Выполнить задание целиком. Вызывается в фоне (void) и при подборе после рестарта. */
export async function runGroupingJob(fastify: FastifyInstance, jobId: string): Promise<void> {
  const job = await claim(fastify, jobId);
  if (!job) return; // уже выполняется, отменено или ещё не время ретрая

  const controller = new AbortController();
  runningJobs.set(jobId, controller);
  const started = Date.now();

  try {
    const scope: LoadScope = {
      estimateId: job.estimate_id,
      orgId: job.scope_org_id,
      contractorIds: job.payload?.contractorIds ?? [],
    };
    const lines = await loadGroupingLines(fastify.pool, scope);
    if (lines.length === 0) throw new Error('В выбранной области нет материалов');

    // Промпты/модель/режим берём ИЗ СНИМКА задания — resume и retry обязаны идти на том же
    // тексте, что и первый прогон и что учтён в input_hash. Fallback (резолв из БД) — только для
    // заданий, созданных до появления снимка (переживших деплой).
    const snap = job.payload?.snapshot ?? {};
    const qualifiedModel = snap.model ?? (await resolveAiModel(fastify.pool));
    const ep = resolveLlmEndpoint(qualifiedModel, await loadLlmRuntime(fastify.pool));
    if (!ep.enabled) throw new Error('ИИ-провайдер не настроен');
    const noThink = snap.noThink ?? (ep.isLmStudio && (await resolveQwenNoThink(fastify.pool)));
    const systemBase = snap.groupingSystem ?? (await resolvePrompt(fastify.pool, 'grouping.system'));
    const mergeSystem = snap.groupingMerge ?? (await resolvePrompt(fastify.pool, 'grouping.merge'));

    const batches = planBatches(lines, job.settings);
    const deadline = started + (ep.isLmStudio ? JOB_DEADLINE_LM_MS : JOB_DEADLINE_OR_MS);
    const batchTimeout = ep.isLmStudio ? BATCH_TIMEOUT_LM_MS : BATCH_TIMEOUT_OR_MS;

    // prompt_version уже записан при создании задания (эффективная версия с отпечатком). Здесь
    // только уточняем фактическую модель и план наборов.
    await fastify.pool.query(
      `UPDATE material_grouping_jobs
          SET batches_total = $2, batch_plan = $3::jsonb, model = $4
        WHERE id = $1`,
      [
        jobId,
        batches.length,
        JSON.stringify(batches.map((b) => ({ index: b.index, partitionKey: b.partitionKey, lines: b.lines.length }))),
        `${ep.provider}:${ep.model}`,
      ],
    );

    // Resume: наборы из checkpoint не пересчитываем. План детерминирован, поэтому индексы
    // после рестарта означают ровно те же строки.
    const done: Record<string, DraftBatch> = { ...(job.checkpoint?.batches ?? {}) };
    const system = buildSystemPrompt(job.settings, systemBase);

    const runBatch = async (batch: GroupingBatch): Promise<void> => {
      if (done[String(batch.index)]) return;
      if (Date.now() > deadline) throw new Error('Превышено время выполнения задания');
      const call = () =>
        chatJsonOnce(
          { endpoint: ep, signal: controller.signal, timeoutMs: batchTimeout, noThink },
          system,
          buildBatchUserPrompt(batch, job.settings),
        );
      // Слот берём на КАЖДЫЙ набор, а не на весь прогон: удержание слота на 20 минут
      // заблокировало бы ИИ-чат целиком (у LM Studio worker = 1).
      const raw = ep.isLmStudio ? await withLmStudioSlot(call) : await call();
      done[String(batch.index)] = parseBatchResponse(raw, batch);
      await heartbeat(fastify, jobId, Object.keys(done).length, { batches: done, merges: job.checkpoint?.merges ?? [] });
    };

    if (ep.isLmStudio) {
      for (const b of batches) {
        if (controller.signal.aborted) throw new Error('aborted');
        await runBatch(b);
      }
    } else {
      // OpenRouter параллелим, но умеренно: у прокси свои лимиты.
      for (let i = 0; i < batches.length; i += OR_PARALLEL) {
        if (controller.signal.aborted) throw new Error('aborted');
        await Promise.all(batches.slice(i, i + OR_PARALLEL).map(runBatch));
      }
    }

    const drafts = batches.map((b) => done[String(b.index)]).filter((d): d is DraftBatch => !!d);
    if (drafts.length === 0) throw new Error('Модель не вернула ни одного разобранного ответа');

    // Слияние — только для областей, разъехавшихся по нескольким наборам.
    const merges: MergeOp[] = [...(job.checkpoint?.merges ?? [])];
    if (merges.length === 0) {
      for (const partitionKey of partitionsNeedingMerge(batches)) {
        const groups = drafts.filter((d) => d.partitionKey === partitionKey).flatMap((d) => d.groups);
        if (groups.length < 2) continue;
        if (controller.signal.aborted) throw new Error('aborted');
        try {
          const call = () =>
            chatJsonOnce(
              { endpoint: ep, signal: controller.signal, timeoutMs: MERGE_TIMEOUT_MS, noThink },
              mergeSystem,
              buildMergeUserPrompt(groups),
            );
          const raw = ep.isLmStudio ? await withLmStudioSlot(call) : await call();
          merges.push(...parseMergeResponse(raw, new Set(groups.map((g) => g.id))));
        } catch (err) {
          // Слияние — улучшение, а не обязательный шаг: его сбой не должен убивать прогон.
          fastify.log.warn({ err, jobId, partitionKey }, 'material grouping merge failed');
        }
      }
    }

    const { result, warnings } = assembleResult(lines, drafts, merges, batches.length);

    const upd = await fastify.pool.query(
      `UPDATE material_grouping_jobs
          SET status = 'ready', result = $2::jsonb, warnings = $3::jsonb,
              batches_done = $4, checkpoint = '{}'::jsonb, locked_by = NULL, locked_until = NULL,
              last_error = NULL
        WHERE id = $1 AND status = 'running' AND locked_by = $5
        RETURNING id`,
      [jobId, JSON.stringify(result), JSON.stringify(warnings), drafts.length, WORKER_ID],
    );
    if (upd.rowCount === 0) fastify.log.warn({ jobId }, 'material grouping job was cancelled before completion');
  } catch (err) {
    const aborted = controller.signal.aborted;
    const message = err instanceof Error ? err.message : String(err);
    if (aborted) {
      await fastify.pool
        .query(
          `UPDATE material_grouping_jobs SET status = 'cancelled', locked_by = NULL, locked_until = NULL
            WHERE id = $1 AND status = 'running'`,
          [jobId],
        )
        .catch(() => {});
    } else {
      fastify.log.error({ err, jobId }, 'material grouping job failed');
      // Исчерпали попытки → dead-state (стандарт): администратор перезапускает вручную.
      await fastify.pool
        .query(
          `UPDATE material_grouping_jobs
              SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
                  last_error = $2,
                  next_run_at = now() + ($3 || ' seconds')::interval,
                  locked_by = NULL, locked_until = NULL
            WHERE id = $1 AND status = 'running'`,
          [jobId, message, String(nextRunDelaySec(job.attempts))],
        )
        .catch(() => {});
    }
  } finally {
    runningJobs.delete(jobId);
  }
}

/**
 * Подобрать задания, брошенные упавшим процессом: истёк locked_until либо ждут ретрая.
 * Без этого прогон на 20 минут терялся бы при каждом деплое.
 */
export async function requeueStaleJobs(fastify: FastifyInstance): Promise<void> {
  const { rows } = await fastify.pool.query<{ id: string }>(
    `SELECT id FROM material_grouping_jobs
      WHERE status IN ('pending', 'running')
        AND next_run_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY created_at
      LIMIT 5`,
  );
  for (const r of rows) void runGroupingJob(fastify, r.id);
}
