/**
 * Постановка заданий группировки — единственная точка создания.
 *
 * Результат принадлежит паре (смета, подрядчик). Ставится он ПО ОТКРЫТИЮ РАЗДЕЛА (ленивый вызов из
 * GET /jobs/latest), а не по правке сметы: прогон стоит токенов и минут, и платить за него имеет
 * смысл только когда результат кому-то нужен прямо сейчас. Правка сметы результат не пересчитывает,
 * а лишь помечает устаревшим (stale считается на лету по input_hash). Правка НЕназначенного этому
 * подрядчику материала на его input_hash не влияет — его результат не устаревает. «Пересчитать» у
 * администратора — тот же вызов с force.
 *
 * Не чаще раза в COOLDOWN_MS по scope: иначе получается петля — открытая вкладка досчитала, а
 * сметчик за эти минуты правил смету, и следующее чтение немедленно ставит новый полный прогон.
 *
 * Правила про уже существующее задание те же, что и раньше (кэш / активное / pending / running),
 * но всё — в пределах scope (estimate_id + scope_hash с подрядчиком).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import type { GroupingScope } from '@estimat/shared';
import { loadLlmRuntime, resolveLlmEndpoint } from '../llm/endpoint.js';
import { resolveAiModel, resolveQwenNoThink } from '../llm/settings.js';
import { resolveAllPrompts } from '../llm/prompts.js';
import { computeEffectivePromptVersion, computeInputHash, computeScopeHash, loadGroupingLines } from './input.js';
import { PROMPT_VERSION } from './prompt.js';
import { abortGroupingJob, runGroupingJob } from './run.js';

/** Больше строк модель осмысленно не свяжет, а прогон растянется на часы. */
export const MAX_GROUPING_LINES = 1600;

/**
 * Минимальный интервал между автоматическими прогонами одного scope. Ограничивает частоту ТРАТ, а не
 * свежесть результата. Полчаса — тот возраст результата, который сметчику ещё не мешает.
 */
const COOLDOWN_MS = 30 * 60_000;

export interface GroupingJobRow {
  id: string;
  estimate_id: string;
  scope_org_id: string | null;
  status: string;
  input_hash: string;
  batches_total: number;
  batches_done: number;
  attempts: number;
  max_attempts: number;
  result: unknown;
  warnings: string[];
  last_error: string | null;
  cancel_reason: string | null;
  model: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export type EnsureReason =
  | 'created'
  | 'cached'
  | 'active'
  | 'cooldown'
  | 'suppressed'
  | 'disabled'
  | 'empty'
  | 'too_many';

/** Почему автоматической постановки не будет. Панель обязана сказать это прямо. */
export type SuppressedBy = 'manual_stop' | 'terminal_failure';

export interface EnsureResult {
  job: GroupingJobRow | null;
  reason: EnsureReason;
  suppressedBy?: SuppressedBy;
  retryAfter?: Date;
}

/**
 * Ставить ли расчёт автоматически. Чистая функция.
 *
 * Ручная остановка держится ПО SCOPE, вход игнорируется: снимает её только «Пересчитать» (force).
 * Исчерпание попыток (dead) держится только на ТОМ ЖЕ входе. Служебная отмена (superseded) не
 * подавляет ничего.
 */
export function decideSuppression(
  last: { status: string; input_hash: string; cancel_reason: string | null } | null,
  paused: boolean,
  currentInputHash: string,
): SuppressedBy | null {
  if (paused) return 'manual_stop';
  if (last?.status === 'dead' && last.input_hash === currentInputHash) return 'terminal_failure';
  return null;
}

/**
 * Ждать ли до следующего автоматического прогона. Только при готовом результате: есть что показать,
 * спешить некуда. На dead/cancelled действуют свои правила (decideSuppression).
 */
export function decideCooldown(
  last: { status: string; created_at: Date | string } | null,
  nowMs: number,
  cooldownMs: number,
): Date | null {
  if (last?.status !== 'ready') return null;
  const readyAt = new Date(last.created_at).getTime();
  const until = readyAt + cooldownMs;
  return nowMs < until ? new Date(until) : null;
}

function startJob(fastify: FastifyInstance, jobId: string, scope: GroupingScope): void {
  void runGroupingJob(fastify, jobId).catch((err) =>
    fastify.log.error({ err, jobId, scope }, 'material grouping: job run failed'),
  );
}

/** Ключ advisory-lock: на scope, чтобы подрядчики одной сметы не блокировали друг друга. */
const scopeLockKey = (scope: GroupingScope): string => `${scope.estimateId}:${scope.contractorId}`;

/**
 * Поставить/обновить группировку для scope (смета + подрядчик), если это нужно. Идемпотентна и
 * безопасна к параллельным вызовам: решение принимается под advisory-lock на scope.
 */
export async function ensureEstimateGrouping(
  fastify: FastifyInstance,
  scope: GroupingScope,
  opts: { actorUserId: string | null; force?: boolean },
): Promise<EnsureResult> {
  const scopeHash = computeScopeHash(scope);

  // Дешёвый отсев до тяжёлой подготовки: на остановленном scope чтение состава и резолв промптов
  // не нужны. Решение всё равно перепроверяется под advisory-lock ниже.
  if (!opts.force) {
    const { rowCount } = await fastify.pool.query(
      'SELECT 1 FROM material_grouping_pauses WHERE estimate_id = $1 AND contractor_id = $2',
      [scope.estimateId, scope.contractorId],
    );
    if (rowCount! > 0) {
      const { rows } = await fastify.pool.query<GroupingJobRow>(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2
          ORDER BY created_at DESC LIMIT 1`,
        [scope.estimateId, scopeHash],
      );
      return { job: rows[0] ?? null, reason: 'suppressed', suppressedBy: 'manual_stop' };
    }
  }

  const qualifiedModel = await resolveAiModel(fastify.pool);
  const ep = resolveLlmEndpoint(qualifiedModel, await loadLlmRuntime(fastify.pool));
  if (!ep.enabled) return { job: null, reason: 'disabled' };

  const lines = await loadGroupingLines(fastify.pool, scope);
  if (lines.length === 0) return { job: null, reason: 'empty' };
  if (lines.length > MAX_GROUPING_LINES) return { job: null, reason: 'too_many' };

  // Снимок промптов/режима фиксируется на момент создания: input_hash, первый прогон и
  // resume/retry обязаны работать на одном и том же тексте.
  const prompts = await resolveAllPrompts(fastify.pool);
  const noThink = ep.isLmStudio && (await resolveQwenNoThink(fastify.pool));
  const snapshot = {
    groupingSystem: prompts['grouping.system'],
    groupingMerge: prompts['grouping.merge'],
    model: qualifiedModel,
    noThink,
  };
  const promptVersion = computeEffectivePromptVersion(
    PROMPT_VERSION,
    snapshot.groupingSystem,
    snapshot.groupingMerge,
    noThink,
  );
  const inputHash = computeInputHash(lines, qualifiedModel, promptVersion);

  const client = await fastify.pool.connect();
  let created: GroupingJobRow | null = null;
  let result: EnsureResult | null = null;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scopeLockKey(scope)]);

    if (!opts.force) {
      const cached = await client.query<GroupingJobRow>(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2 AND input_hash = $3 AND status = 'ready'
          ORDER BY created_at DESC LIMIT 1`,
        [scope.estimateId, scopeHash, inputHash],
      );
      if (cached.rows[0]) result = { job: cached.rows[0], reason: 'cached' };
    }

    if (!result && !opts.force) {
      const [pause, last] = await Promise.all([
        client.query(`SELECT 1 FROM material_grouping_pauses WHERE estimate_id = $1 AND contractor_id = $2`, [
          scope.estimateId,
          scope.contractorId,
        ]),
        client.query<GroupingJobRow>(
          `SELECT * FROM material_grouping_jobs
            WHERE estimate_id = $1 AND scope_hash = $2
            ORDER BY created_at DESC LIMIT 1`,
          [scope.estimateId, scopeHash],
        ),
      ]);
      const lastRow = last.rows[0] ?? null;
      const suppressedBy = decideSuppression(lastRow, pause.rowCount! > 0, inputHash);
      if (suppressedBy) result = { job: lastRow, reason: 'suppressed', suppressedBy };

      if (!result) {
        const retryAfter = decideCooldown(lastRow, Date.now(), COOLDOWN_MS);
        if (retryAfter) result = { job: lastRow, reason: 'cooldown', retryAfter };
      }
    }

    if (!result) {
      const decided = await decideOnActive(client, { scope, scopeHash, inputHash, force: opts.force });
      if (decided) result = decided;
    }

    if (!result) {
      const ins = await client.query<GroupingJobRow>(
        `INSERT INTO material_grouping_jobs
           (estimate_id, created_by, scope_org_id, scope_hash, input_hash, client_request_id,
            settings, payload, input, model, prompt_version)
         VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7::jsonb, $8::jsonb, $9, $10)
         RETURNING *`,
        [
          scope.estimateId,
          opts.actorUserId,
          scope.contractorId,
          scopeHash,
          inputHash,
          randomUUID(),
          JSON.stringify({ snapshot }),
          // Полный канонический снимок строк: раннер работает по нему, а не по живой смете.
          JSON.stringify({ lines }),
          `${ep.provider}:${ep.model}`,
          promptVersion,
        ],
      );
      created = ins.rows[0] ?? null;
      result = { job: created, reason: 'created' };
      await client.query('DELETE FROM material_grouping_pauses WHERE estimate_id = $1 AND contractor_id = $2', [
        scope.estimateId,
        scope.contractorId,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if ((err as { code?: string })?.code === '23505') return { job: null, reason: 'active' };
    throw err;
  } finally {
    client.release();
  }

  if (created) startJob(fastify, created.id, scope);
  return result;
}

/** Что делать с активным заданием scope. null — активного нет либо оно снято, можно вставлять. */
async function decideOnActive(
  client: PoolClient,
  ctx: { scope: GroupingScope; scopeHash: string; inputHash: string; force?: boolean },
): Promise<EnsureResult | null> {
  const { rows } = await client.query<GroupingJobRow>(
    `SELECT * FROM material_grouping_jobs
      WHERE estimate_id = $1 AND scope_hash = $2 AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.scope.estimateId, ctx.scopeHash],
  );
  const active = rows[0];
  if (!active) return null;

  if (!ctx.force && active.input_hash === ctx.inputHash) return { job: active, reason: 'active' };
  if (!ctx.force && active.status === 'running') return { job: active, reason: 'active' };

  abortGroupingJob(active.id);
  await client.query(
    `UPDATE material_grouping_jobs
        SET status = 'cancelled', cancel_reason = 'superseded', cancelled_at = now(),
            locked_by = NULL, locked_until = NULL
      WHERE id = $1 AND status IN ('pending', 'running')`,
    [active.id],
  );
  return null;
}
