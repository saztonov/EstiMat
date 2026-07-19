/**
 * Умная группировка материалов сметы (ИИ).
 *
 * Результат принадлежит паре (смета, подрядчик): ИИ группирует только материалы работ,
 * назначенных подрядчику, в количествах его доли. Задание ставится при чтении этого роута — то
 * есть по открытию раздела и не чаще, чем разрешает задержка (lib/material-grouping/enqueue.ts).
 * Правка сметы пересчёта не запускает.
 *
 * Доступ к чтению — по смете. Подрядчик считает и видит только свой scope (его организация); чужой
 * contractorId сервер игнорирует. Проекции общего результата больше нет — расчёт сразу по scope.
 */
import type { FastifyInstance } from 'fastify';
import {
  createGroupingJobSchema,
  type GroupingActivity,
  type GroupingCallDetail,
  type GroupingCallSummary,
  type GroupingJob,
  type GroupingLastAttempt,
  type GroupingResult,
  type GroupingScope,
  type GroupingSuppressedBy,
} from '@estimat/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { assertContractorEstimateAccess } from '../../lib/material-requests/access.js';
import { loadLlmRuntime, resolveLlmEndpoint } from '../../lib/llm/endpoint.js';
import { resolveAiModel, resolveQwenNoThink } from '../../lib/llm/settings.js';
import { resolveAllPrompts } from '../../lib/llm/prompts.js';
import { computeEffectivePromptVersion, computeInputHash, computeScopeHash, loadGroupingLines } from '../../lib/material-grouping/input.js';
import { PROMPT_VERSION } from '../../lib/material-grouping/prompt.js';
import { ensureEstimateGrouping } from '../../lib/material-grouping/enqueue.js';
import { abortGroupingJob, requeueStaleJobs } from '../../lib/material-grouping/run.js';

/** Задание живёт 30 дней: результат привязан к составу сметы и быстро устаревает. */
const RETENTION_DAYS = 30;
const CALL_LOG_TEXT_RETENTION_DAYS = 7;
const REQUEUE_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;

interface CurrentUser {
  id: string;
  orgId: string | null;
  role: 'admin' | 'engineer' | 'contractor' | 'manager';
}

function mapJob(r: any, result?: GroupingResult | null): GroupingJob {
  return {
    id: r.id,
    estimateId: r.estimate_id,
    contractorId: r.scope_org_id ?? null,
    status: r.status,
    settings: r.settings,
    inputHash: r.input_hash,
    batchesTotal: r.batches_total,
    batchesDone: r.batches_done,
    result: result !== undefined ? result : (r.result ?? null),
    warnings: r.warnings ?? [],
    error: r.last_error ?? null,
    model: r.model ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export default async function materialGroupingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  void requeueStaleJobs(fastify);
  const timer = setInterval(() => void requeueStaleJobs(fastify), REQUEUE_INTERVAL_MS);
  timer.unref();

  async function cleanup(): Promise<void> {
    await fastify.pool.query(
      `UPDATE ai_llm_calls
          SET system_text = NULL, request_text = NULL, response_text = NULL, texts_purged_at = now()
        WHERE created_at < now() - ($1 || ' days')::interval
          AND texts_purged_at IS NULL
          AND status NOT IN ('queued', 'waiting_slot', 'in_progress')`,
      [String(CALL_LOG_TEXT_RETENTION_DAYS)],
    );
    await fastify.pool.query(
      `DELETE FROM material_grouping_jobs
        WHERE created_at < now() - ($1 || ' days')::interval AND status IN ('ready', 'failed', 'cancelled', 'dead')`,
      [String(RETENTION_DAYS)],
    );
  }

  void cleanup().catch((err) => fastify.log.error({ err }, 'material grouping retention cleanup failed'));
  const cleanupTimer = setInterval(
    () => void cleanup().catch((err) => fastify.log.error({ err }, 'material grouping retention cleanup failed')),
    CLEANUP_INTERVAL_MS,
  );
  cleanupTimer.unref();

  fastify.addHook('onClose', async () => {
    clearInterval(timer);
    clearInterval(cleanupTimer);
  });

  /** Доступ к смете. */
  async function assertAccess(estimateId: string, user: CurrentUser): Promise<void> {
    if (user.role === 'contractor') {
      if (!user.orgId) throw new ChatAccessError('Пользователь не привязан к организации', 400);
      const ok = await assertContractorEstimateAccess(fastify.pool, estimateId, user.orgId);
      if (!ok) throw new ChatAccessError('Нет доступа к смете');
      return;
    }
    await assertEstimateAccess(fastify.pool, estimateId, user);
  }

  /**
   * Область расчёта. Подрядчику — всегда его организация: чужой contractorId игнорируется, чтобы он
   * не мог заказать или прочитать расчёт другого подрядчика. Сотруднику contractorId обязателен.
   */
  function resolveScope(estimateId: string, contractorId: string | undefined, user: CurrentUser): GroupingScope {
    if (user.role === 'contractor') {
      if (!user.orgId) throw new ChatAccessError('Пользователь не привязан к организации', 400);
      return { estimateId, contractorId: user.orgId };
    }
    if (!contractorId) throw new ChatAccessError('Не выбран подрядчик', 400);
    return { estimateId, contractorId };
  }

  /** Доступ к конкретному заданию: подрядчик видит только задания своей организации. */
  function assertJobScope(job: { scope_org_id: string | null }, user: CurrentUser): void {
    if (user.role === 'contractor' && job.scope_org_id !== user.orgId) {
      throw new ChatAccessError('Задание не найдено', 404);
    }
  }

  function handleAccessError(err: unknown, reply: any): boolean {
    if (err instanceof ChatAccessError) {
      reply.status(err.status).send({ error: err.message });
      return true;
    }
    return false;
  }

  /** Актуален ли результат: сравниваем input_hash задания с хэшем текущего состава входа scope. */
  async function isStale(job: { estimate_id: string; scope_org_id: string | null; input_hash: string }): Promise<boolean> {
    if (!job.scope_org_id) return false;
    const scope: GroupingScope = { estimateId: job.estimate_id, contractorId: job.scope_org_id };
    const qualifiedModel = await resolveAiModel(fastify.pool);
    const ep = resolveLlmEndpoint(qualifiedModel, await loadLlmRuntime(fastify.pool));
    const lines = await loadGroupingLines(fastify.pool, scope);
    if (lines.length === 0) return false;
    const prompts = await resolveAllPrompts(fastify.pool);
    const noThink = ep.isLmStudio && (await resolveQwenNoThink(fastify.pool));
    const promptVersion = computeEffectivePromptVersion(
      PROMPT_VERSION,
      prompts['grouping.system'],
      prompts['grouping.merge'],
      noThink,
    );
    return computeInputHash(lines, qualifiedModel, promptVersion) !== job.input_hash;
  }

  async function loadActivity(jobId: string): Promise<GroupingActivity | null> {
    const { rows } = await fastify.pool.query(
      `SELECT status, batch_index, http_attempts, started_at
         FROM ai_llm_calls
        WHERE material_grouping_job_id = $1 AND status IN ('queued', 'waiting_slot', 'in_progress')
        ORDER BY started_at DESC LIMIT 1`,
      [jobId],
    );
    const row = rows[0];
    if (!row) return null;
    const attempts = (row.http_attempts ?? []) as Array<{ status: number | null }>;
    const withStatus = [...attempts].reverse().find((a) => a.status != null);
    return {
      stage: row.status,
      batchNumber: row.batch_index == null ? null : row.batch_index + 1,
      httpAttempt: attempts.length + 1,
      lastHttpStatus: withStatus?.status ?? null,
      since: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
    };
  }

  // POST /jobs — «Пересчитать». Только админ: запуск затрагивает scope и стоит токенов.
  fastify.post('/jobs', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = createGroupingJobSchema.parse(request.body);
    const user = request.currentUser as CurrentUser;

    let scope: GroupingScope;
    try {
      await assertAccess(body.estimateId, user);
      scope = resolveScope(body.estimateId, body.contractorId, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    const { job, reason } = await ensureEstimateGrouping(fastify, scope, {
      actorUserId: user.id,
      force: body.force ?? true,
    });

    if (reason === 'disabled') {
      return reply.status(409).send({ error: 'ИИ-провайдер не настроен', code: 'llm_disabled' });
    }
    if (reason === 'empty') return reply.status(422).send({ error: 'У подрядчика нет назначенных материалов' });
    if (reason === 'too_many') return reply.status(422).send({ error: 'Слишком много позиций; лимит 1600' });
    if (reason === 'suppressed') {
      return reply.status(409).send({ error: 'Пересчёт остановлен вручную', code: 'suppressed' });
    }
    if (reason === 'cooldown') {
      return reply.status(409).send({ error: 'Группировка пересчитывалась недавно', code: 'cooldown' });
    }
    if (!job) {
      return reply.status(409).send({ error: 'Группировка уже выполняется', code: 'already_running' });
    }
    return reply.status(reason === 'created' ? 202 : 200).send({ data: mapJob(job, job.result as GroupingResult | null) });
  });

  // GET /jobs/latest?estimateId=&contractorId= — результат scope.
  fastify.get('/jobs/latest', async (request, reply) => {
    const { estimateId, contractorId } = request.query as { estimateId?: string; contractorId?: string };
    if (!estimateId) return reply.status(400).send({ error: 'estimateId обязателен' });
    const user = request.currentUser as CurrentUser;

    let scope: GroupingScope;
    try {
      await assertAccess(estimateId, user);
      scope = resolveScope(estimateId, contractorId, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }
    const scopeHash = computeScopeHash(scope);

    const ep = resolveLlmEndpoint(await resolveAiModel(fastify.pool), await loadLlmRuntime(fastify.pool));

    const [readyRows, activeRows, lastRows] = await Promise.all([
      fastify.pool.query(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2 AND status = 'ready' AND result IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
        [estimateId, scopeHash],
      ),
      fastify.pool.query(
        `SELECT id, status, batches_done, batches_total, attempts, max_attempts, last_error, next_run_at
           FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2 AND status IN ('pending', 'running')
          ORDER BY created_at DESC LIMIT 1`,
        [estimateId, scopeHash],
      ),
      fastify.pool.query(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2 ORDER BY created_at DESC LIMIT 1`,
        [estimateId, scopeHash],
      ),
    ]);

    const ready = readyRows.rows[0] ?? null;
    let activeRow = activeRows.rows[0] ?? null;
    const job = ready ?? lastRows.rows[0] ?? null;

    const stale = ready && !activeRow ? await isStale(ready) : false;

    let lastAttempt: GroupingLastAttempt | null = null;
    let autoRunSuppressed: GroupingSuppressedBy | null = null;
    let nextAutoRunAt: string | null = null;
    if (!activeRow && (!job || stale)) {
      try {
        const ensured = await ensureEstimateGrouping(fastify, scope, { actorUserId: user.id });
        if (ensured.job && (ensured.reason === 'created' || ensured.reason === 'active')) {
          activeRow = {
            id: ensured.job.id,
            status: ensured.job.status,
            batches_done: ensured.job.batches_done,
            batches_total: ensured.job.batches_total,
            attempts: ensured.job.attempts,
            max_attempts: ensured.job.max_attempts,
            last_error: ensured.job.last_error,
            next_run_at: null,
          };
        }
        if (ensured.reason === 'cooldown') nextAutoRunAt = ensured.retryAfter?.toISOString() ?? null;
        if (ensured.reason === 'suppressed') {
          autoRunSuppressed = ensured.suppressedBy ?? null;
          if (ensured.job) {
            lastAttempt = {
              id: ensured.job.id,
              status: ensured.job.status === 'dead' ? 'dead' : 'cancelled',
              error: ensured.job.last_error,
              attempts: ensured.job.attempts,
              stoppedByUser: ensured.suppressedBy === 'manual_stop',
            };
          }
        }
      } catch (err) {
        fastify.log.warn({ err, estimateId, scope }, 'material grouping: lazy ensure failed');
      }
    }

    return reply.send({
      data: job ? mapJob(job, (job.result ?? null) as GroupingResult | null) : null,
      active: activeRow
        ? {
            id: activeRow.id,
            status: activeRow.status,
            batchesDone: activeRow.batches_done,
            batchesTotal: activeRow.batches_total,
            attempts: activeRow.attempts ?? 1,
            maxAttempts: activeRow.max_attempts ?? 3,
            lastError: activeRow.last_error ?? null,
            nextRunAt:
              activeRow.status === 'pending' && activeRow.next_run_at
                ? new Date(activeRow.next_run_at).toISOString()
                : null,
            activity: await loadActivity(activeRow.id),
          }
        : null,
      available: ep.enabled,
      stale,
      lastAttempt,
      autoRunSuppressed,
      nextAutoRunAt,
    });
  });

  // GET /jobs/:id/calls — журнал обмена с моделью, краткий вид.
  fastify.get('/jobs/:id/calls', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.currentUser as CurrentUser;
    const { rows: jobRows } = await fastify.pool.query('SELECT * FROM material_grouping_jobs WHERE id = $1', [id]);
    const job = jobRows[0];
    if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
    try {
      await assertAccess(job.estimate_id, user);
      assertJobScope(job, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    const { rows } = await fastify.pool.query(
      `SELECT id, attempt, kind, batch_index, lines_count, status, parse_status, groups_count,
              http_status, http_attempts, total_tokens, error, started_at, duration_ms
         FROM ai_llm_calls
        WHERE material_grouping_job_id = $1
        ORDER BY started_at, id`,
      [id],
    );

    const data: GroupingCallSummary[] = rows.map((r) => ({
      id: r.id,
      attempt: r.attempt,
      kind: r.kind,
      batchIndex: r.batch_index,
      linesCount: r.lines_count,
      status: r.status,
      parseStatus: r.parse_status,
      groupsCount: r.groups_count,
      httpStatus: r.http_status,
      httpAttempts: Array.isArray(r.http_attempts) ? r.http_attempts.length : 0,
      totalTokens: r.total_tokens,
      error: r.error,
      startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at),
      durationMs: r.duration_ms,
    }));

    reply.header('Cache-Control', 'no-store');
    return reply.send({
      job: {
        id: job.id,
        status: job.status,
        model: job.model,
        promptVersion: job.prompt_version,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        batchesDone: job.batches_done,
        batchesTotal: job.batches_total,
        error: job.last_error,
        nextRunAt: job.status === 'pending' && job.next_run_at ? new Date(job.next_run_at).toISOString() : null,
        createdAt: job.created_at instanceof Date ? job.created_at.toISOString() : String(job.created_at),
      },
      data,
    });
  });

  /** GET /jobs/:id/calls/:callId — что именно ушло в модель и что она ответила. */
  fastify.get('/jobs/:id/calls/:callId', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { id, callId } = request.params as { id: string; callId: string };
    const user = request.currentUser as CurrentUser;
    const { rows: jobRows } = await fastify.pool.query(
      'SELECT estimate_id, scope_org_id, model FROM material_grouping_jobs WHERE id = $1',
      [id],
    );
    const job = jobRows[0];
    if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
    try {
      await assertAccess(job.estimate_id, user);
      assertJobScope(job, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    const { rows } = await fastify.pool.query(
      `SELECT * FROM ai_llm_calls WHERE id = $1 AND material_grouping_job_id = $2`,
      [callId, id],
    );
    const r = rows[0];
    if (!r) return reply.status(404).send({ error: 'Вызов не найден' });

    const data: GroupingCallDetail = {
      id: r.id,
      attempt: r.attempt,
      kind: r.kind,
      batchIndex: r.batch_index,
      linesCount: r.lines_count,
      status: r.status,
      parseStatus: r.parse_status,
      groupsCount: r.groups_count,
      httpStatus: r.http_status,
      httpAttempts: Array.isArray(r.http_attempts) ? r.http_attempts.length : 0,
      totalTokens: r.total_tokens,
      error: r.error,
      startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at),
      durationMs: r.duration_ms,
      model: r.model,
      finishReason: r.finish_reason,
      partitionKey: r.partition_key,
      systemText: r.system_text,
      requestText: r.request_text,
      responseText: r.response_text,
      parseWarnings: r.parse_warnings ?? [],
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      attemptsLog: r.http_attempts ?? [],
    };
    reply.header('Cache-Control', 'no-store');
    return reply.send({ data });
  });

  // GET /jobs/:id
  fastify.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.currentUser as CurrentUser;
    const { rows } = await fastify.pool.query('SELECT * FROM material_grouping_jobs WHERE id = $1', [id]);
    const job = rows[0];
    if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
    try {
      await assertAccess(job.estimate_id, user);
      assertJobScope(job, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }
    return reply.send({ data: mapJob(job, (job.result ?? null) as GroupingResult | null) });
  });

  /**
   * POST /jobs/:id/cancel — «Остановить». Идемпотентна. Только админ.
   *
   * Останавливает группировку scope целиком: ставит паузу на (смета, подрядчик), которую снимает
   * только «Пересчитать». Паузы других подрядчиков не затрагиваются.
   */
  fastify.post('/jobs/:id/cancel', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.currentUser as CurrentUser;
    const { rows } = await fastify.pool.query('SELECT * FROM material_grouping_jobs WHERE id = $1', [id]);
    const job = rows[0];
    if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
    try {
      await assertAccess(job.estimate_id, user);
      assertJobScope(job, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }
    const contractorId: string | null = job.scope_org_id;

    const client = await fastify.pool.connect();
    let row = job;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${job.estimate_id}:${contractorId ?? ''}`]);
      if (contractorId) {
        await client.query(
          `INSERT INTO material_grouping_pauses (estimate_id, contractor_id, paused_by, paused_job_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (estimate_id, contractor_id) DO UPDATE
              SET paused_at = now(), paused_by = EXCLUDED.paused_by, paused_job_id = EXCLUDED.paused_job_id`,
          [job.estimate_id, contractorId, user.id, id],
        );
      }
      // Гасим активные задания ЭТОГО scope, а не всей сметы: прогоны других подрядчиков продолжаются.
      const upd = await client.query(
        `UPDATE material_grouping_jobs
            SET status = 'cancelled', cancel_reason = 'manual', cancelled_at = now(), cancelled_by = $3,
                locked_by = NULL, locked_until = NULL
          WHERE estimate_id = $1 AND scope_hash = $2 AND status IN ('pending', 'running')
          RETURNING *`,
        [job.estimate_id, job.scope_hash, user.id],
      );
      await client.query('COMMIT');
      row = upd.rows.find((r) => r.id === id) ?? upd.rows[0] ?? job;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    abortGroupingJob(id);
    if (row.id !== id) abortGroupingJob(row.id);
    return reply.send({ data: mapJob(row, (row.result ?? null) as GroupingResult | null) });
  });
}
