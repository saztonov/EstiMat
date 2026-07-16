/**
 * Умная группировка материалов сметы (ИИ).
 *
 * Результат ОДИН на смету и одинаков для всех: он не запускается пользователем и не зависит от
 * его отборов. Постановка задания — автоматическая (lib/material-grouping/enqueue.ts), здесь
 * только чтение и «Пересчитать» для администратора.
 *
 * Доступ к чтению — по смете, а не по роли: вкладку видит и подрядчик. Ему ответ обрезается до
 * его строк (lib/material-grouping/project.ts) — общий результат содержит названия материалов
 * всей сметы.
 */
import type { FastifyInstance } from 'fastify';
import { createGroupingJobSchema, type GroupingJob, type GroupingResult } from '@estimat/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { assertContractorEstimateAccess } from '../../lib/material-requests/access.js';
import { loadLlmRuntime, resolveLlmEndpoint } from '../../lib/llm/endpoint.js';
import { resolveAiModel, resolveGroupingLevels, resolveQwenNoThink } from '../../lib/llm/settings.js';
import { resolveAllPrompts } from '../../lib/llm/prompts.js';
import {
  computeEffectivePromptVersion,
  computeInputHash,
  loadContractorOrderKeys,
  loadGroupingLines,
} from '../../lib/material-grouping/input.js';
import { PROMPT_VERSION } from '../../lib/material-grouping/prompt.js';
import {
  affectsGrouping,
  ensureEstimateGrouping,
  scheduleGroupingRefresh,
} from '../../lib/material-grouping/enqueue.js';
import { projectResultFor } from '../../lib/material-grouping/project.js';
import { abortGroupingJob, requeueStaleJobs } from '../../lib/material-grouping/run.js';

/** Задание живёт 30 дней: результат привязан к составу сметы и быстро устаревает. */
const RETENTION_DAYS = 30;
const REQUEUE_INTERVAL_MS = 60_000;

interface CurrentUser {
  id: string;
  orgId: string | null;
  role: 'admin' | 'engineer' | 'contractor' | 'manager';
}

function mapJob(r: any, result?: GroupingResult | null): GroupingJob {
  return {
    id: r.id,
    estimateId: r.estimate_id,
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

  // Подобрать задания, брошенные упавшим процессом, и продолжить их с последнего набора.
  void requeueStaleJobs(fastify);
  const timer = setInterval(() => void requeueStaleJobs(fastify), REQUEUE_INTERVAL_MS);
  timer.unref();

  // Группировка безусловна: смету изменили — результат обновляется сам, без действий пользователя.
  // Подписка одна на все сметы вместо вызова из каждого роута, который правит смету (их 11).
  const unsubscribe = fastify.onEstimateChanged((event) => {
    if (!affectsGrouping(event.reason)) return;
    scheduleGroupingRefresh(fastify, event.estimateId);
  });

  fastify.addHook('onClose', async () => {
    clearInterval(timer);
    unsubscribe();
  });

  fastify.pool
    .query(
      `DELETE FROM material_grouping_jobs
        WHERE created_at < now() - ($1 || ' days')::interval AND status IN ('ready', 'failed', 'cancelled', 'dead')`,
      [String(RETENTION_DAYS)],
    )
    .catch((err) => fastify.log.error({ err }, 'material grouping retention cleanup failed'));

  /** Доступ к смете. Область больше не зависит от пользователя — результат общий. */
  async function assertAccess(estimateId: string, user: CurrentUser): Promise<void> {
    if (user.role === 'contractor') {
      if (!user.orgId) throw new ChatAccessError('Пользователь не привязан к организации', 400);
      const ok = await assertContractorEstimateAccess(fastify.pool, estimateId, user.orgId);
      if (!ok) throw new ChatAccessError('Нет доступа к смете');
      return;
    }
    await assertEstimateAccess(fastify.pool, estimateId, user);
  }

  function handleAccessError(err: unknown, reply: any): boolean {
    if (err instanceof ChatAccessError) {
      reply.status(err.status).send({ error: err.message });
      return true;
    }
    return false;
  }

  /** Актуален ли результат: сравниваем input_hash задания с хэшем текущего состава сметы. */
  async function isStale(job: { estimate_id: string; input_hash: string }): Promise<boolean> {
    const qualifiedModel = await resolveAiModel(fastify.pool);
    const ep = resolveLlmEndpoint(qualifiedModel, await loadLlmRuntime(fastify.pool));
    const lines = await loadGroupingLines(fastify.pool, job.estimate_id);
    if (lines.length === 0) return false;
    const settings = await resolveGroupingLevels(fastify.pool);
    const prompts = await resolveAllPrompts(fastify.pool);
    const noThink = ep.isLmStudio && (await resolveQwenNoThink(fastify.pool));
    const promptVersion = computeEffectivePromptVersion(
      PROMPT_VERSION,
      prompts['grouping.system'],
      prompts['grouping.merge'],
      noThink,
    );
    return computeInputHash(lines, settings, qualifiedModel, promptVersion) !== job.input_hash;
  }

  /** Подрядчику — только его строки; сотруднику — полный результат. */
  async function resultFor(job: any, user: CurrentUser): Promise<GroupingResult | null> {
    const result = (job.result ?? null) as GroupingResult | null;
    if (!result || user.role !== 'contractor' || !user.orgId) return result;
    const visible = await loadContractorOrderKeys(fastify.pool, job.estimate_id, user.orgId);
    return projectResultFor(result, visible);
  }

  // POST /jobs — «Пересчитать». Только админ: результат общий, и запуск затрагивает всех.
  fastify.post('/jobs', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const body = createGroupingJobSchema.parse(request.body);
    const user = request.currentUser as CurrentUser;

    try {
      await assertAccess(body.estimateId, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    const { job, reason } = await ensureEstimateGrouping(fastify, body.estimateId, {
      actorUserId: user.id,
      force: body.force ?? true,
    });

    if (reason === 'disabled') {
      return reply.status(409).send({ error: 'ИИ-провайдер не настроен', code: 'llm_disabled' });
    }
    if (reason === 'empty') return reply.status(422).send({ error: 'В смете нет материалов' });
    if (reason === 'too_many') return reply.status(422).send({ error: 'Слишком много позиций; лимит 1600' });
    if (!job) {
      return reply.status(409).send({ error: 'Группировка по этой смете уже выполняется', code: 'already_running' });
    }
    return reply.status(reason === 'created' ? 202 : 200).send({ data: mapJob(job, await resultFor(job, user)) });
  });

  // GET /jobs/latest?estimateId= — общий результат сметы.
  fastify.get('/jobs/latest', async (request, reply) => {
    const { estimateId } = request.query as { estimateId?: string };
    if (!estimateId) return reply.status(400).send({ error: 'estimateId обязателен' });
    const user = request.currentUser as CurrentUser;

    try {
      await assertAccess(estimateId, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    const ep = resolveLlmEndpoint(await resolveAiModel(fastify.pool), await loadLlmRuntime(fastify.pool));

    // Готовый результат и идущий расчёт — разные задания: во время пересчёта (10–25 мин) экран
    // не должен пустеть, поэтому показываем прежний результат и прогресс рядом.
    const [readyRows, activeRows, lastRows] = await Promise.all([
      fastify.pool.query(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND status = 'ready' AND result IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
        [estimateId],
      ),
      fastify.pool.query(
        `SELECT id, status, batches_done, batches_total FROM material_grouping_jobs
          WHERE estimate_id = $1 AND status IN ('pending', 'running')
          ORDER BY created_at DESC LIMIT 1`,
        [estimateId],
      ),
      fastify.pool.query(
        `SELECT * FROM material_grouping_jobs WHERE estimate_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [estimateId],
      ),
    ]);

    const ready = readyRows.rows[0] ?? null;
    let activeRow = activeRows.rows[0] ?? null;
    // Нет готового — показываем последнее задание: у него статус ошибки или отмены.
    const job = ready ?? lastRows.rows[0] ?? null;

    // Устаревание считает сервер: у подрядчика на руках лишь часть строк, сам он этого не увидит.
    // Пока идёт расчёт — не считаем: и так известно, что результат обновляется, а проверка стоит
    // полного чтения состава сметы (клиент в это время поллит раз в 1.5 с).
    const stale = ready && !activeRow ? await isStale(ready) : false;

    // Самовосстановление: группировка безусловна, поэтому отсутствие результата или устаревший
    // результат — повод поставить задание. Событие с шины могло потеряться (reconnect LISTEN), а
    // сметы, назначенные до этой версии, заданий не имеют вовсе.
    // Ждём постановки, а не пускаем в фон: клиент включает поллинг по active, и без него экран
    // «формируется» завис бы до ручного обновления страницы.
    // failed/dead/cancelled не перезапускаем — иначе падающее задание крутилось бы в цикле.
    if (!activeRow && (!job || stale)) {
      try {
        const ensured = await ensureEstimateGrouping(fastify, estimateId, { actorUserId: user.id });
        if (ensured.job && (ensured.reason === 'created' || ensured.reason === 'active')) {
          activeRow = {
            id: ensured.job.id,
            status: ensured.job.status,
            batches_done: ensured.job.batches_done,
            batches_total: ensured.job.batches_total,
          };
        }
      } catch (err) {
        // Не роняем чтение: показать имеющееся важнее, чем поставить пересчёт.
        fastify.log.warn({ err, estimateId }, 'material grouping: lazy ensure failed');
      }
    }

    // Готовый результат остаётся доступен, даже если ИИ потом выключили.
    return reply.send({
      data: job ? mapJob(job, await resultFor(job, user)) : null,
      active: activeRow
        ? {
            id: activeRow.id,
            status: activeRow.status,
            batchesDone: activeRow.batches_done,
            batchesTotal: activeRow.batches_total,
          }
        : null,
      available: ep.enabled,
      stale,
    });
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
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }
    return reply.send({ data: mapJob(job, await resultFor(job, user)) });
  });

  // POST /jobs/:id/cancel — идемпотентна. Только админ: расчёт общий.
  fastify.post('/jobs/:id/cancel', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.currentUser as CurrentUser;
    const { rows } = await fastify.pool.query('SELECT * FROM material_grouping_jobs WHERE id = $1', [id]);
    const job = rows[0];
    if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
    try {
      await assertAccess(job.estimate_id, user);
    } catch (err) {
      if (handleAccessError(err, reply)) return;
      throw err;
    }

    abortGroupingJob(id);
    const upd = await fastify.pool.query(
      `UPDATE material_grouping_jobs
          SET status = 'cancelled', locked_by = NULL, locked_until = NULL
        WHERE id = $1 AND status IN ('pending', 'running')
        RETURNING *`,
      [id],
    );
    const row = upd.rows[0] ?? job;
    return reply.send({ data: mapJob(row, await resultFor(row, user)) });
  });
}
