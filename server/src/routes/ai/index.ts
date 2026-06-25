import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createAiJobSchema, extractionResultSchema } from '@estimat/shared';
import { config } from '../../config.js';
import { applyExtraction } from '../../lib/extract/apply.js';
import { makeEstimateEvent } from '../../lib/realtime/bus.js';
import { loadLegacyWorksSnapshot } from '../../lib/extract/catalog-source.js';
import { runExtraction } from '../../lib/extract/pipeline.js';
import { createOpenRouterPort } from '../../lib/extract/llm/openrouter.js';
import type { SectionScope, ExtractRules } from '../../lib/extract/types.js';

// Накопленные правила (sectionToWork/lessons/синонимы) — поверх вшитых дефолтов кода.
// Best-effort: критичные алиасы уже в коде, файла может не быть в прод-образе.
let cachedRules: ExtractRules | null = null;
function loadExtractRules(): ExtractRules {
  if (cachedRules) return cachedRules;
  const candidates = [
    join(process.cwd(), 'scripts', 'ai-extract', 'rules.json'),
    join(process.cwd(), '..', 'scripts', 'ai-extract', 'rules.json'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        cachedRules = JSON.parse(readFileSync(p, 'utf-8')) as ExtractRules;
        return cachedRules;
      }
    } catch {
      /* ignore — используем дефолты кода */
    }
  }
  cachedRules = {};
  return cachedRules;
}

// Реестр выполняющихся заданий для остановки (AbortController на задание).
// Корректно при одном инстансе API (текущий прод single-VPS). Гонку «отмена vs
// запуск» дополнительно закрывают УСЛОВНЫЕ переходы статуса (WHERE status=...).
const runningJobs = new Map<string, AbortController>();

/** Модель LLM: дефолт из настроек (app_settings.ai_model_default), иначе из env. */
async function resolveAiModel(fastify: FastifyInstance): Promise<string> {
  const r = await fastify.pool.query(`SELECT value FROM app_settings WHERE key = 'ai_model_default'`);
  const v = r.rows[0]?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : config.ai.model;
}

// Фаза 2: фоновое извлечение встроенным движком (OpenRouter). Берёт markdown из
// ai_jobs.input.markdown, прогоняет ядро, пишет результат и применяет позиции в смету.
// Переходы статуса условные, чтобы отмена (cancel) не перетиралась раннером.
async function runJobInBackground(fastify: FastifyInstance, jobId: string): Promise<void> {
  const { rows } = await fastify.pool.query('SELECT * FROM ai_jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) return;
  const markdown: string | null = job.input?.markdown ?? null;
  if (!markdown) return; // без markdown движок не запускаем
  const scope: SectionScope | undefined = job.input?.sectionScope ?? undefined;

  // pending → running (условно). Если задание уже отменили — выходим.
  const claim = await fastify.pool.query(
    `UPDATE ai_jobs SET status = 'running' WHERE id = $1 AND status = 'pending' RETURNING id`,
    [jobId],
  );
  if (claim.rowCount === 0) return;

  const controller = new AbortController();
  runningJobs.set(jobId, controller);
  try {
    // Источник для AI-извлечения фиксирован: только legacy-справочник работ
    // (настройка ai_catalog_source AI-блок не управляет). Материалы — из РД.
    const catalog = await loadLegacyWorksSnapshot(fastify.pool, scope);
    const model = await resolveAiModel(fastify);
    const port = createOpenRouterPort({
      apiKey: config.ai.apiKey,
      model,
      baseUrl: config.ai.baseUrl,
      signal: controller.signal,
    });
    const result = await runExtraction(markdown, catalog, loadExtractRules(), port, scope, controller.signal);
    if (controller.signal.aborted) throw new Error('aborted');

    const projectId = (await fastify.pool.query('SELECT project_id FROM estimates WHERE id = $1', [job.estimate_id])).rows[0]?.project_id ?? null;
    const correlationId = randomUUID();
    const client = await fastify.pool.connect();
    let applied = false;
    try {
      await client.query('BEGIN');
      // running → applied (условно). Если отменили во время прогона — откат, apply не выполняем.
      const upd = await client.query(
        `UPDATE ai_jobs SET status = 'applied', result = $2::jsonb, model = $3
         WHERE id = $1 AND status = 'running' RETURNING id`,
        [jobId, JSON.stringify(result), `openrouter:${model}`],
      );
      if (upd.rowCount === 0) {
        await client.query('ROLLBACK');
        return; // отменено — позиции не добавляем
      }
      await applyExtraction(
        client,
        {
          estimateId: job.estimate_id,
          projectId,
          aiJobId: job.id,
          sourceDocId: job.source_ref ?? null,
          actorUserId: job.created_by ?? null,
          correlationId,
        },
        result,
      );
      await client.query('COMMIT');
      applied = true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // Realtime-эмит после COMMIT (видно всем открывшим смету, в т.ч. коллегам).
    if (applied) {
      await fastify.publishEstimateChanged(
        makeEstimateEvent({ estimateId: job.estimate_id, projectId, reason: 'ai_applied', actorUserId: job.created_by ?? null, correlationId }),
      );
    }
  } catch (err) {
    if (controller.signal.aborted) {
      await fastify.pool
        .query(`UPDATE ai_jobs SET status = 'cancelled' WHERE id = $1 AND status = 'running'`, [jobId])
        .catch(() => {});
    } else {
      fastify.log.error({ err, jobId }, 'ai job background failed');
      await fastify.pool
        .query(`UPDATE ai_jobs SET status = 'failed', error = $2 WHERE id = $1 AND status = 'running'`, [
          jobId,
          err instanceof Error ? err.message : String(err),
        ])
        .catch(() => {});
    }
  } finally {
    runningJobs.delete(jobId);
  }
}

// Задания ИИ-извлечения работ/материалов из РД. Встроенный движок (OpenRouter)
// запускается автоматически при создании задания, если задан ключ OpenRouter.
export default async function aiRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // POST /api/ai/jobs — создать задание извлечения (и сразу запустить движок)
  fastify.post(
    '/jobs',
    {
      preHandler: [requireRole('admin', 'engineer')],
      bodyLimit: 20 * 1024 * 1024, // РД-.md приходит строкой в JSON; дефолт Fastify 1 МБ мал
    },
    async (request, reply) => {
      const body = createAiJobSchema.parse(request.body);

      const est = await fastify.pool.query('SELECT id FROM estimates WHERE id = $1', [body.estimateId]);
      if (est.rows.length === 0) return reply.status(404).send({ error: 'Смета не найдена' });

      const input = {
        markdown: body.markdown ?? null,
        query: body.query ?? null,
        sourceRef: body.sourceRef ?? null,
        sectionScope: body.sectionScope ?? null,
      };

      const { rows } = await fastify.pool.query(
        `INSERT INTO ai_jobs (estimate_id, source_kind, source_ref, input, status, created_by)
         VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
         RETURNING *`,
        [body.estimateId, body.sourceKind, body.sourceRef ?? null, JSON.stringify(input), request.currentUser.id],
      );
      const job = rows[0];

      // Встроенный движок: при наличии ключа OpenRouter и markdown — запускаем извлечение в фоне.
      if (config.ai.enabled && body.markdown) {
        void runJobInBackground(fastify, job.id);
      }

      return reply.status(201).send({ data: job });
    },
  );

  // GET /api/ai/jobs?estimateId= — задания сметы; без estimateId — админский список всех заданий
  fastify.get('/jobs', async (request, reply) => {
    const { estimateId } = request.query as { estimateId?: string };
    if (estimateId) {
      const { rows } = await fastify.pool.query(
        `SELECT id, estimate_id, source_kind, source_ref, status, error, model, created_by, created_at, updated_at
         FROM ai_jobs WHERE estimate_id = $1 ORDER BY created_at DESC`,
        [estimateId],
      );
      return { data: rows };
    }
    if (request.currentUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Доступ только администратору' });
    }
    const { rows } = await fastify.pool.query(
      `SELECT j.id, j.estimate_id, j.source_kind, j.source_ref, j.status, j.error, j.model,
              j.created_at, j.updated_at,
              u.full_name AS created_by_name,
              p.name      AS project_name,
              (j.result->'stats'->>'works')::int     AS works_count,
              (j.result->'stats'->>'materials')::int AS materials_count
       FROM ai_jobs j
       LEFT JOIN users u      ON j.created_by = u.id
       LEFT JOIN estimates e  ON j.estimate_id = e.id
       LEFT JOIN projects p   ON e.project_id = p.id
       ORDER BY j.created_at DESC
       LIMIT 200`,
    );
    return { data: rows };
  });

  // GET /api/ai/jobs/:id — задание с результатом (для прогресса/превью)
  fastify.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query('SELECT * FROM ai_jobs WHERE id = $1', [request.params.id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Задание не найдено' });
    return { data: rows[0] };
  });

  // POST /api/ai/jobs/:id/cancel — остановить задание (отмена выполнения)
  fastify.post<{ Params: { id: string } }>(
    '/jobs/:id/cancel',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { id } = request.params;
      const exists = await fastify.pool.query('SELECT id FROM ai_jobs WHERE id = $1', [id]);
      if (exists.rows.length === 0) return reply.status(404).send({ error: 'Задание не найдено' });

      // Условный перевод в cancelled (только из активных статусов) + прерывание in-flight прогона.
      const upd = await fastify.pool.query(
        `UPDATE ai_jobs SET status = 'cancelled' WHERE id = $1 AND status IN ('pending', 'running') RETURNING id`,
        [id],
      );
      runningJobs.get(id)?.abort();
      if (upd.rowCount === 0) return reply.status(409).send({ error: 'Задание уже завершено' });
      return { data: { id, status: 'cancelled' } };
    },
  );

  // DELETE /api/ai/jobs/:id — удалить запись задания (только терминальное; позиции в смете
  // остаются — FK ai_job_id это ON DELETE SET NULL). Активное удалять нельзя — сначала остановить.
  fastify.delete<{ Params: { id: string } }>(
    '/jobs/:id',
    { preHandler: [requireRole('admin')] },
    async (request, reply) => {
      const { rows } = await fastify.pool.query('SELECT status FROM ai_jobs WHERE id = $1', [request.params.id]);
      if (rows.length === 0) return reply.status(404).send({ error: 'Задание не найдено' });
      if (rows[0].status === 'pending' || rows[0].status === 'running') {
        return reply.status(409).send({ error: 'Сначала остановите задание' });
      }
      await fastify.pool.query('DELETE FROM ai_jobs WHERE id = $1', [request.params.id]);
      return { success: true };
    },
  );

  // POST /api/ai/jobs/:id/apply — применить ГОТОВЫЙ результат к смете (только из статуса 'ready').
  fastify.post<{ Params: { id: string } }>(
    '/jobs/:id/apply',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rows } = await fastify.pool.query('SELECT * FROM ai_jobs WHERE id = $1', [request.params.id]);
      const job = rows[0];
      if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
      if (job.status !== 'ready') {
        return reply.status(409).send({ error: 'Задание не в статусе «готово»' });
      }

      const parsed = extractionResultSchema.safeParse(job.result);
      if (!parsed.success) return reply.status(400).send({ error: 'Результат задания отсутствует или некорректен' });

      const projectId = (await fastify.pool.query('SELECT project_id FROM estimates WHERE id = $1', [job.estimate_id])).rows[0]?.project_id ?? null;
      const correlationId = randomUUID();
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // ready → applied (условно).
        const upd = await client.query(
          `UPDATE ai_jobs SET status = 'applied' WHERE id = $1 AND status = 'ready' RETURNING id`,
          [job.id],
        );
        if (upd.rowCount === 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Задание уже не в статусе «готово»' });
        }
        const stats = await applyExtraction(
          client,
          {
            estimateId: job.estimate_id,
            projectId,
            aiJobId: job.id,
            sourceDocId: job.source_ref ?? null,
            actorUserId: request.currentUser.id,
            correlationId,
          },
          parsed.data,
        );
        await client.query('COMMIT');
        await fastify.publishEstimateChanged(
          makeEstimateEvent({ estimateId: job.estimate_id, projectId, reason: 'ai_applied', actorUserId: request.currentUser.id, correlationId }),
        );
        return { data: { ...stats } };
      } catch (err) {
        await client.query('ROLLBACK');
        fastify.log.error({ err }, 'ai apply failed');
        return reply.status(500).send({ error: 'Не удалось применить результат' });
      } finally {
        client.release();
      }
    },
  );
}
