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
import { loadLlmRuntime, resolveLlmEndpoint } from '../llm/endpoint.js';
import { withLmStudioSlot } from '../llm/limiter.js';
import { resolveAiModel, resolveQwenNoThink } from '../llm/settings.js';
import { resolvePrompt } from '../llm/prompts.js';
import { chatJsonOnce, LlmCallError, LlmEmptyResponseError, LlmTimeoutError } from '../llm/chat-json.js';
import { loadGroupingLines } from './input.js';
import { planBatches } from './batch.js';
import { buildSystemPrompt, buildBatchUserPrompt, buildMergeUserPrompt } from './prompt.js';
import { parseBatchResponse, parseMergeResponse } from './parse.js';
import { applyMerges, assembleResult, type MergeOp } from './assemble.js';
import { closeDanglingCalls, finishCall, markCall, startCall, type CallStatus } from './call-log.js';
import type { DraftBatch, DraftGroup, GroupingBatch, GroupingLine } from './types.js';

/** Сколько раундов reduce делаем максимум, если модель продолжает находить слияния. */
const MAX_MERGE_ROUNDS = 3;

/** Идентификатор процесса-исполнителя: чей это захват. */
const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

const LOCK_TTL_MS = 5 * 60_000;
/** Продлеваем блокировку после каждого набора: живое задание не должен подобрать watchdog. */
const HEARTBEAT_MS = LOCK_TTL_MS;
/**
 * Таймаут ОДНОЙ попытки. У шлюза он обязан быть больше дедлайна прокси (190 с): оборвав запрос
 * раньше, мы получаем 499 в его журнале и оплаченный ответ, который не прочитали. Прежние 90 с
 * ровно это и делали.
 */
const ATTEMPT_TIMEOUT_LM_MS = 240_000;
const ATTEMPT_TIMEOUT_OR_MS = 200_000;
/**
 * Бюджет вызова: попытки вместе с паузами. Одного таймаута на весь вызов не хватает — при
 * таймауте больше дедлайна прокси повтор в него просто не помещался бы.
 */
const CALL_BUDGET_LM_MS = 600_000;
const CALL_BUDGET_OR_MS = 420_000;
const JOB_DEADLINE_LM_MS = 40 * 60_000;
/**
 * Дедлайн задания. 40 минут: смета в 1600 строк (заявленный максимум) — это ~22 набора, по два
 * одновременно, то есть ~9 минут при обычном ответе модели и ~21 при медленном. Прежних 8 минут не
 * хватало на такую смету уже до перехода на два одновременных запроса.
 */
const JOB_DEADLINE_OR_MS = 40 * 60_000;
const OR_PARALLEL = 4;
/**
 * Заданий на процесс. Потолок шлюза всё равно два запроса, и третье задание не посчитается
 * быстрее — оно лишь растянет первые два и подведёт их под дедлайн.
 */
const MAX_CONCURRENT_JOBS = 2;

const runningJobs = new Map<string, AbortController>();

/** Остановить выполняющееся задание этого процесса. */
export function abortGroupingJob(jobId: string): void {
  runningJobs.get(jobId)?.abort();
}

/** Снимок промптов/режима, зафиксированный при создании задания (см. lib/material-grouping/enqueue). */
interface JobSnapshot {
  groupingSystem?: string;
  groupingMerge?: string;
  model?: string;
  noThink?: boolean;
}

interface JobRow {
  id: string;
  estimate_id: string;
  /** Подрядчик задания (scope_org_id). Нужен для fallback-чтения снимка у старых заданий. */
  scope_org_id: string | null;
  payload: { snapshot?: JobSnapshot };
  /** Канонический снимок строк входа, зафиксированный при создании. */
  input: { lines?: GroupingLine[] } | null;
  attempts: number;
  max_attempts: number;
  checkpoint: { batches?: Record<string, DraftBatch>; merges?: MergeOp[] };
}

/** Backoff с jitter (стандарт): без разброса все упавшие задания ретраятся синхронно. */
function nextRunDelaySec(attempt: number): number {
  const base = Math.min(300, 30 * 2 ** attempt);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

/** Чем закончился вызов — для журнала. Таймаут и отмену различаем: причины разные. */
function callStatusOf(cause: unknown, aborted: boolean): CallStatus {
  if (cause instanceof LlmTimeoutError) return 'timed_out';
  if (cause instanceof LlmEmptyResponseError) return 'empty';
  if (aborted) return 'cancelled';
  return 'failed';
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
      RETURNING id, estimate_id, scope_org_id, payload, input, attempts, max_attempts, checkpoint`,
    [jobId, WORKER_ID, String(LOCK_TTL_MS)],
  );
  return rows[0] ?? null;
}

/**
 * Продлить только блокировку. Нужен потому, что heartbeat ниже привязан к ЗАВЕРШЁННОМУ набору, а
 * один набор с повтором занимает до 7 минут (бюджет вызова) — дольше, чем живёт блокировка. Без
 * этого watchdog забрал бы живое задание, и над ним работали бы два исполнителя сразу.
 */
async function touchLock(fastify: FastifyInstance, jobId: string): Promise<void> {
  await fastify.pool
    .query(
      `UPDATE material_grouping_jobs
          SET locked_until = now() + ($2 || ' milliseconds')::interval
        WHERE id = $1 AND locked_by = $3 AND status = 'running'`,
      [jobId, String(LOCK_TTL_MS), WORKER_ID],
    )
    .catch(() => {});
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
  // Блокировку продлеваем по таймеру, а не только после набора: набор с повтором идёт дольше, чем
  // она живёт, и живое задание досталось бы watchdog'у вторым исполнителем.
  const lockTimer = setInterval(() => void touchLock(fastify, jobId), LOCK_TTL_MS / 3);
  lockTimer.unref();
  // Прошлую попытку могли оборвать деплоем: её незакрытые записи иначе вечно показывали бы
  // «отправляем запрос».
  await closeDanglingCalls(fastify, jobId);

  try {
    // Вход берём из СНИМКА задания, а не из живой сметы: правка сметы во время прогона не должна
    // разъезжаться с тем, что заказали и учли в input_hash. Fallback (чтение по scope) — только
    // для заданий, созданных до появления снимка.
    const lines =
      job.input?.lines ??
      (job.scope_org_id
        ? await loadGroupingLines(fastify.pool, { estimateId: job.estimate_id, contractorId: job.scope_org_id })
        : []);
    if (lines.length === 0) throw new Error('В смете нет материалов');

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

    // Фактическая модель, а не строка из снимка: при варианте «OpenRouter (прокси)» снимок хранит
    // 'openrouter:' без идентификатора, и журнал не отвечал бы на вопрос, чем считали.
    const actualModel = `${ep.provider}:${ep.model}`;
    const batches = planBatches(lines);
    const deadline = started + (ep.isLmStudio ? JOB_DEADLINE_LM_MS : JOB_DEADLINE_OR_MS);
    const attemptTimeout = ep.isLmStudio ? ATTEMPT_TIMEOUT_LM_MS : ATTEMPT_TIMEOUT_OR_MS;
    const callBudget = ep.isLmStudio ? CALL_BUDGET_LM_MS : CALL_BUDGET_OR_MS;
    /** Суммарное ожидание слота LM Studio: очередь — не работа задания, в дедлайн не входит. */
    let waitedForSlotMs = 0;

    // prompt_version уже записан при создании задания (эффективная версия с отпечатком). Здесь
    // только уточняем фактическую модель и план наборов.
    await fastify.pool.query(
      `UPDATE material_grouping_jobs
          SET batches_total = $2, batch_plan = $3::jsonb, model = $4
        WHERE id = $1`,
      [
        jobId,
        batches.length,
        JSON.stringify(batches.map((b) => ({ index: b.index, partitionKey: b.affinityKey, lines: b.lines.length }))),
        actualModel,
      ],
    );

    // Resume: наборы из checkpoint не пересчитываем. План детерминирован, поэтому индексы
    // после рестарта означают ровно те же строки.
    const done: Record<string, DraftBatch> = { ...(job.checkpoint?.batches ?? {}) };
    const system = buildSystemPrompt(systemBase);

    const runBatch = async (batch: GroupingBatch): Promise<void> => {
      if (done[String(batch.index)]) return;
      // Дедлайн — на РАБОТУ задания, а не на его пребывание в очереди: ожидание слота вычитаем.
      // Иначе несколько смет, открытых одновременно, встают в очередь к LM Studio (worker = 1),
      // растягивают друг друга и упираются в дедлайн — при исчерпании попыток задание уходит в
      // dead, откуда его поднимает только ручной «Пересчитать».
      if (Date.now() - waitedForSlotMs > deadline) throw new Error('Превышено время выполнения задания');
      const userPrompt = buildBatchUserPrompt(batch);
      // Запись заводим до отправки: пока модель думает, журнал обязан показывать сам факт работы.
      const callId = await startCall(fastify, {
        jobId,
        attempt: job.attempts,
        kind: 'batch',
        batchIndex: batch.index,
        partitionKey: batch.affinityKey,
        linesCount: batch.lines.length,
        model: actualModel,
      });
      const call = async () => {
        await markCall(fastify, callId, 'in_progress');
        return chatJsonOnce(
          {
            endpoint: ep,
            signal: controller.signal,
            attemptTimeoutMs: attemptTimeout,
            callBudgetMs: callBudget,
            // Ключ повторов — id записи журнала: она заведена до отправки, живёт ровно этот вызов и
            // одна на все его попытки. Заодно ключ в журнале прокси совпадает с нашим id вызова.
            idempotencyKey: callId ?? undefined,
            noThink,
          },
          system,
          userPrompt,
        );
      };

      let res;
      try {
        // Слот берём на КАЖДЫЙ набор, а не на весь прогон: удержание слота на 20 минут
        // заблокировало бы ИИ-чат целиком (у LM Studio worker = 1).
        if (ep.isLmStudio) {
          const queuedAt = Date.now();
          await markCall(fastify, callId, 'waiting_slot');
          res = await withLmStudioSlot(() => {
            // Колбэк выполняется уже в слоте — разница и есть время ожидания в очереди.
            waitedForSlotMs += Date.now() - queuedAt;
            return call();
          });
        } else {
          res = await call();
        }
      } catch (err) {
        if (err instanceof LlmCallError) {
          await finishCall(fastify, callId, {
            status: callStatusOf(err.cause, controller.signal.aborted),
            systemText: err.sentSystem,
            requestText: err.sentUser,
            attempts: err.attempts,
            error: err.message,
            durationMs: err.durationMs,
          });
        } else {
          await finishCall(fastify, callId, {
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            systemText: system,
            requestText: userPrompt,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }

      // Разбор — отдельная ось: HTTP успешен, но JSON мог оказаться непригодным. Пустой список
      // групп ошибкой НЕ считается: ответ может состоять из одних общих/несгруппированных.
      const draft = parseBatchResponse(res.content, batch);
      const parsedNothing =
        draft.groups.length === 0 && draft.sharedKeys.length === 0 && draft.ungroupedKeys.length === 0;
      await finishCall(fastify, callId, {
        status: 'succeeded',
        parseStatus: parsedNothing ? 'failed' : draft.warnings.length > 0 ? 'warnings' : 'ok',
        parseWarnings: draft.warnings,
        groupsCount: draft.groups.length,
        systemText: res.sentSystem,
        requestText: res.sentUser,
        responseText: res.content,
        finishReason: res.finishReason,
        usage: res.usage,
        attempts: res.attempts,
        durationMs: res.durationMs,
      });

      done[String(batch.index)] = draft;
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

    // Слияние — ГЛОБАЛЬНОЕ: вида работ как границы больше нет, одну операцию под разными видами
    // работ можно слить. Итеративно, пока модель находит слияния, но не больше MAX_MERGE_ROUNDS:
    // на каждом раунде модель видит уже укрупнённые группы.
    const linesByKey = new Map<string, GroupingLine>(lines.map((l) => [l.orderKey, l]));
    const allGroups = drafts.flatMap((d) => d.groups);
    const merges: MergeOp[] = [...(job.checkpoint?.merges ?? [])];
    const startedRounds = merges.length > 0; // resume: раунды уже были — не гоняем заново
    for (let round = 0; !startedRounds && round < MAX_MERGE_ROUNDS; round++) {
      if (controller.signal.aborted) throw new Error('aborted');
      // Текущее состояние с накопленными слияниями — на клоне, чтобы не мутировать drafts до сборки.
      const current: DraftGroup[] = applyMerges(structuredClone(allGroups), merges).groups;
      if (current.length < 2) break;
      const mergePrompt = buildMergeUserPrompt(current, linesByKey);
      const callId = await startCall(fastify, {
        jobId,
        attempt: job.attempts,
        kind: 'merge',
        batchIndex: null,
        partitionKey: `round-${round}`,
        linesCount: current.length,
        model: qualifiedModel,
      });
      try {
        const call = async () => {
          await markCall(fastify, callId, 'in_progress');
          return chatJsonOnce(
            {
              endpoint: ep,
              signal: controller.signal,
              attemptTimeoutMs: attemptTimeout,
              callBudgetMs: callBudget,
              idempotencyKey: callId ?? undefined,
              noThink,
            },
            mergeSystem,
            mergePrompt,
          );
        };
        const res = ep.isLmStudio ? await withLmStudioSlot(call) : await call();
        const ops = parseMergeResponse(res.content, new Set(current.map((g) => g.id)));
        await finishCall(fastify, callId, {
          status: 'succeeded',
          parseStatus: 'ok',
          groupsCount: ops.length,
          systemText: res.sentSystem,
          requestText: res.sentUser,
          responseText: res.content,
          finishReason: res.finishReason,
          usage: res.usage,
          attempts: res.attempts,
          durationMs: res.durationMs,
        });
        if (ops.length === 0) break; // сходимость: сливать больше нечего
        merges.push(...ops);
        // Сохраняем раунды в checkpoint: при рестарте reduce не гоняем заново.
        await heartbeat(fastify, jobId, Object.keys(done).length, { batches: done, merges });
      } catch (err) {
        // Слияние — улучшение, а не обязательный шаг: его сбой не должен убивать прогон.
        if (err instanceof LlmCallError) {
          await finishCall(fastify, callId, {
            status: callStatusOf(err.cause, controller.signal.aborted),
            systemText: err.sentSystem,
            requestText: err.sentUser,
            attempts: err.attempts,
            error: err.message,
            durationMs: err.durationMs,
          });
        } else {
          await finishCall(fastify, callId, {
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            systemText: mergeSystem,
            requestText: mergePrompt,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        fastify.log.warn({ err, jobId, round }, 'material grouping merge failed');
        break;
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
    clearInterval(lockTimer);
    runningJobs.delete(jobId);
  }
}

/**
 * Подобрать задания, брошенные упавшим процессом: истёк locked_until либо ждут ретрая.
 * Без этого прогон на 20 минут терялся бы при каждом деплое.
 *
 * Берём не больше, чем свободно до потолка. Ограничивать только выборку бесполезно: поднятые
 * задания держат locked_until и в неё уже не попадают, поэтому каждый тик добавлял бы к ним новые —
 * за пять минут набирались десятки, и все они дрались за два слота шлюза.
 */
export async function requeueStaleJobs(fastify: FastifyInstance): Promise<void> {
  const free = MAX_CONCURRENT_JOBS - runningJobs.size;
  if (free <= 0) return;
  const { rows } = await fastify.pool.query<{ id: string }>(
    `SELECT id FROM material_grouping_jobs
      WHERE status IN ('pending', 'running')
        AND next_run_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY created_at
      LIMIT $1`,
    [free],
  );
  for (const r of rows) void runGroupingJob(fastify, r.id);
}
