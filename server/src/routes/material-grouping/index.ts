/**
 * Умная группировка материалов сметы (ИИ).
 *
 * Доступ — по смете, а не по роли: представление доступно всем, кто видит вкладку «Материалы»,
 * включая подрядчика. Поэтому requireRole здесь не применяется; подрядчик проверяется через
 * назначение объекта его организации, сотрудник — общим слоем доступа к сметам.
 *
 * Клиент передаёт только область и настройки. Состав строк, названия и количества сервер
 * собирает из БД сам (lib/material-grouping/input.ts).
 */
import type { FastifyInstance } from 'fastify';
import { createGroupingJobSchema, type GroupingJob, type GroupingSettings } from '@estimat/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { assertContractorEstimateAccess } from '../../lib/material-requests/access.js';
import { loadLlmRuntime, resolveLlmEndpoint } from '../../lib/llm/endpoint.js';
import { resolveAiModel, resolveQwenNoThink } from '../../lib/llm/settings.js';
import { resolveAllPrompts } from '../../lib/llm/prompts.js';
import {
  computeEffectivePromptVersion,
  computeInputHash,
  computeScopeHash,
  loadGroupingLines,
  type LoadScope,
} from '../../lib/material-grouping/input.js';
import { PROMPT_VERSION } from '../../lib/material-grouping/prompt.js';
import { abortGroupingJob, requeueStaleJobs, runGroupingJob } from '../../lib/material-grouping/run.js';

/** Задание живёт 30 дней: результат привязан к составу сметы и быстро устаревает. */
const RETENTION_DAYS = 30;
const REQUEUE_INTERVAL_MS = 60_000;

interface CurrentUser {
  id: string;
  orgId: string | null;
  role: 'admin' | 'engineer' | 'contractor' | 'manager';
}

function mapJob(r: any): GroupingJob {
  return {
    id: r.id,
    estimateId: r.estimate_id,
    status: r.status,
    settings: r.settings,
    inputHash: r.input_hash,
    batchesTotal: r.batches_total,
    batchesDone: r.batches_done,
    result: r.result ?? null,
    warnings: r.warnings ?? [],
    error: r.last_error ?? null,
    model: r.model ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export default async function materialGroupingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // Подобрать задания, брошенные упавшим процессом, и продолжить их с последнего набора.
  void requeueStaleJobs(fastify);
  const timer = setInterval(() => void requeueStaleJobs(fastify), REQUEUE_INTERVAL_MS);
  timer.unref();
  fastify.addHook('onClose', async () => clearInterval(timer));

  fastify.pool
    .query(
      `DELETE FROM material_grouping_jobs
        WHERE created_at < now() - ($1 || ' days')::interval AND status IN ('ready', 'failed', 'cancelled', 'dead')`,
      [String(RETENTION_DAYS)],
    )
    .catch((err) => fastify.log.error({ err }, 'material grouping retention cleanup failed'));

  /** Доступ к смете + область данных пользователя. */
  async function resolveScope(estimateId: string, user: CurrentUser, contractorIds: string[]): Promise<LoadScope> {
    if (user.role === 'contractor') {
      if (!user.orgId) throw new ChatAccessError('Пользователь не привязан к организации', 400);
      const ok = await assertContractorEstimateAccess(fastify.pool, estimateId, user.orgId);
      if (!ok) throw new ChatAccessError('Нет доступа к смете');
      // Отбор по подрядчикам подрядчику недоступен: его область — только он сам.
      return { estimateId, orgId: user.orgId, contractorIds: [] };
    }
    await assertEstimateAccess(fastify.pool, estimateId, user);
    return { estimateId, orgId: null, contractorIds };
  }

  function handleAccessError(err: unknown, reply: any): boolean {
    if (err instanceof ChatAccessError) {
      reply.status(err.status).send({ error: err.message });
      return true;
    }
    return false;
  }

  // POST /jobs — создать задание (или отдать готовый результат с тем же входом).
  fastify.post('/jobs', async (request, reply) => {
    const body = createGroupingJobSchema.parse(request.body);
    const user = request.currentUser as CurrentUser;

    let scope: LoadScope;
    try {
      scope = await resolveScope(body.estimateId, user, body.contractorIds ?? []);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    const qualifiedModel = await resolveAiModel(fastify.pool);
    const ep = resolveLlmEndpoint(qualifiedModel, await loadLlmRuntime(fastify.pool));
    // Задание не создаём вовсе: иначе останется вечный pending, который не подберёт даже
    // watchdog (так устроены ai_jobs — здесь этот паттерн не повторяем).
    if (!ep.enabled) {
      return reply.status(409).send({ error: 'ИИ-провайдер не настроен', code: 'llm_disabled' });
    }

    const lines = await loadGroupingLines(fastify.pool, scope);
    if (lines.length === 0) return reply.status(422).send({ error: 'В выбранной области нет материалов' });
    if (lines.length > 1600) {
      return reply.status(422).send({ error: `Слишком много позиций (${lines.length}); лимит 1600` });
    }

    const settings: GroupingSettings = body.settings;
    const scopeHash = computeScopeHash(scope);

    // Снимок промптов/режима — фиксируем на момент создания задания: input_hash, первый прогон и
    // resume/retry обязаны работать на одном и том же тексте. Правка промпта из администрирования
    // влияет только на новые задания.
    const prompts = await resolveAllPrompts(fastify.pool);
    const noThink = ep.isLmStudio && (await resolveQwenNoThink(fastify.pool));
    const snapshot = {
      groupingSystem: prompts['grouping.system'],
      groupingMerge: prompts['grouping.merge'],
      model: qualifiedModel,
      noThink,
    };
    const effectiveVersion = computeEffectivePromptVersion(
      PROMPT_VERSION,
      snapshot.groupingSystem,
      snapshot.groupingMerge,
      noThink,
    );
    const inputHash = computeInputHash(lines, settings, qualifiedModel, effectiveVersion);

    // Повтор того же запроса (двойной клик) — отдаём уже созданное задание.
    const existing = await fastify.pool.query(
      `SELECT * FROM material_grouping_jobs WHERE created_by = $1 AND client_request_id = $2`,
      [user.id, body.clientRequestId],
    );
    if (existing.rows[0]) return reply.status(200).send({ data: mapJob(existing.rows[0]) });

    if (!body.force) {
      const cached = await fastify.pool.query(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2 AND input_hash = $3 AND status = 'ready'
          ORDER BY created_at DESC LIMIT 1`,
        [scope.estimateId, scopeHash, inputHash],
      );
      if (cached.rows[0]) return reply.status(200).send({ data: mapJob(cached.rows[0]) });
    }

    try {
      const { rows } = await fastify.pool.query(
        `INSERT INTO material_grouping_jobs
           (estimate_id, created_by, scope_org_id, scope_hash, input_hash, client_request_id,
            settings, payload, input, model, prompt_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
         RETURNING *`,
        [
          scope.estimateId,
          user.id,
          scope.orgId,
          scopeHash,
          inputHash,
          body.clientRequestId,
          JSON.stringify(settings),
          JSON.stringify({ contractorIds: scope.contractorIds, snapshot }),
          JSON.stringify({ lines: lines.length }),
          `${ep.provider}:${ep.model}`,
          effectiveVersion,
        ],
      );
      const job = rows[0];
      void runGroupingJob(fastify, job.id);
      return reply.status(202).send({ data: mapJob(job) });
    } catch (err: any) {
      // uq_mgj_active_scope: по этой области уже что-то считается.
      if (err?.code === '23505') {
        return reply.status(409).send({
          error: 'Группировка по этим материалам уже выполняется',
          code: 'already_running',
        });
      }
      throw err;
    }
  });

  // GET /jobs/latest?estimateId= — последнее задание в области пользователя.
  fastify.get('/jobs/latest', async (request, reply) => {
    const { estimateId, contractorIds } = request.query as { estimateId?: string; contractorIds?: string };
    if (!estimateId) return reply.status(400).send({ error: 'estimateId обязателен' });
    const user = request.currentUser as CurrentUser;

    let scope: LoadScope;
    try {
      scope = await resolveScope(estimateId, user, contractorIds ? contractorIds.split(',').filter(Boolean) : []);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    const ep = resolveLlmEndpoint(await resolveAiModel(fastify.pool), await loadLlmRuntime(fastify.pool));
    const { rows } = await fastify.pool.query(
      `SELECT * FROM material_grouping_jobs
        WHERE estimate_id = $1 AND scope_hash = $2 AND created_by = $3
        ORDER BY created_at DESC LIMIT 1`,
      [scope.estimateId, computeScopeHash(scope), user.id],
    );
    // Готовый результат остаётся доступен, даже если ИИ потом выключили.
    return reply.send({ data: rows[0] ? mapJob(rows[0]) : null, available: ep.enabled });
  });

  // GET /jobs/:id
  fastify.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.currentUser as CurrentUser;
    const { rows } = await fastify.pool.query('SELECT * FROM material_grouping_jobs WHERE id = $1', [id]);
    const job = rows[0];
    if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
    // Чужое задание не отдаём: у подрядчика в срезе его цифры.
    if (job.created_by !== user.id && user.role !== 'admin') {
      return reply.status(403).send({ error: 'Нет доступа к заданию' });
    }
    try {
      await resolveScope(job.estimate_id, user, []);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }
    return reply.send({ data: mapJob(job) });
  });

  // POST /jobs/:id/cancel — идемпотентна.
  fastify.post('/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.currentUser as CurrentUser;
    const { rows } = await fastify.pool.query('SELECT * FROM material_grouping_jobs WHERE id = $1', [id]);
    const job = rows[0];
    if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
    if (job.created_by !== user.id && user.role !== 'admin') {
      return reply.status(403).send({ error: 'Нет доступа к заданию' });
    }

    abortGroupingJob(id);
    const upd = await fastify.pool.query(
      `UPDATE material_grouping_jobs
          SET status = 'cancelled', locked_by = NULL, locked_until = NULL
        WHERE id = $1 AND status IN ('pending', 'running')
        RETURNING *`,
      [id],
    );
    return reply.send({ data: mapJob(upd.rows[0] ?? job) });
  });
}
