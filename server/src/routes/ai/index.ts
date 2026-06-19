import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createAiJobSchema, extractionResultSchema } from '@estimat/shared';
import { config } from '../../config.js';
import { applyExtraction } from '../../lib/extract/apply.js';
import { loadCatalogSnapshot } from '../../lib/extract/catalog-source.js';
import { runExtraction } from '../../lib/extract/pipeline.js';
import { createOpenRouterPort } from '../../lib/extract/llm/openrouter.js';
import type { CatalogSourceMode, SectionScope } from '../../lib/extract/types.js';

/** Модель LLM: дефолт из настроек (app_settings.ai_model_default), иначе из env. */
async function resolveAiModel(fastify: FastifyInstance): Promise<string> {
  const r = await fastify.pool.query(`SELECT value FROM app_settings WHERE key = 'ai_model_default'`);
  const v = r.rows[0]?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : config.ai.model;
}

// Фаза 2: фоновое извлечение встроенным движком (OpenRouter). Берёт markdown из
// ai_jobs.input.markdown (UI кладёт его и для rd_document, и для upload_md),
// прогоняет ядро, пишет результат и применяет позиции в смету.
async function runJobInBackground(fastify: FastifyInstance, jobId: string): Promise<void> {
  const { rows } = await fastify.pool.query('SELECT * FROM ai_jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) return;
  const markdown: string | null = job.input?.markdown ?? null;
  if (!markdown) return; // catalog_query без markdown — оставляем skill'у
  const scope: SectionScope | undefined = job.input?.sectionScope ?? undefined;

  try {
    await fastify.pool.query(`UPDATE ai_jobs SET status = 'running' WHERE id = $1`, [jobId]);
    const cfg = await fastify.pool.query(`SELECT value FROM app_settings WHERE key = 'ai_catalog_source'`);
    const mode = (cfg.rows[0]?.value as CatalogSourceMode) ?? 'v2_first';
    const catalog = await loadCatalogSnapshot(fastify.pool, mode, scope);
    const model = await resolveAiModel(fastify);
    const port = createOpenRouterPort({ apiKey: config.ai.apiKey, model, baseUrl: config.ai.baseUrl });
    const result = await runExtraction(markdown, catalog, {}, port, scope);

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE ai_jobs SET status = 'ready', result = $2::jsonb, model = $3 WHERE id = $1`, [
        jobId,
        JSON.stringify(result),
        `openrouter:${model}`,
      ]);
      await applyExtraction(
        client,
        { estimateId: job.estimate_id, aiJobId: job.id, sourceDocId: job.source_ref ?? null },
        result,
      );
      await client.query(`UPDATE ai_jobs SET status = 'applied' WHERE id = $1`, [jobId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    fastify.log.error({ err, jobId }, 'ai job background failed');
    await fastify.pool
      .query(`UPDATE ai_jobs SET status = 'failed', error = $2 WHERE id = $1`, [
        jobId,
        err instanceof Error ? err.message : String(err),
      ])
      .catch(() => {});
  }
}

// Задания ИИ-извлечения работ/материалов из РД.
//
// Фаза 1 (текущая): POST /jobs создаёт задание 'pending'. Извлечение выполняет
// skill estimate-extract (Claude Code), он пишет result и применяет позиции.
// Фаза 2 (позже): POST /jobs запускает ядро с OpenRouter-портом в фоне и сам
// доводит задание до 'applied' — UI и схема при этом не меняются.
export default async function aiRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // POST /api/ai/jobs — создать задание извлечения
  fastify.post('/jobs', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createAiJobSchema.parse(request.body);

    // Смета должна существовать.
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
      [
        body.estimateId,
        body.sourceKind,
        body.sourceRef ?? null,
        JSON.stringify(input),
        request.currentUser.id,
      ],
    );
    const job = rows[0];

    // Фаза 2: если встроенный движок настроен (есть ключ OpenRouter) и есть
    // markdown — запускаем извлечение в фоне. Иначе задание ждёт skill.
    if (config.ai.enabled && body.markdown) {
      void runJobInBackground(fastify, job.id);
    }

    return reply.status(201).send({ data: job });
  });

  // GET /api/ai/jobs?estimateId= — список заданий сметы
  fastify.get('/jobs', async (request) => {
    const { estimateId } = request.query as { estimateId?: string };
    const values: string[] = [];
    let where = '';
    if (estimateId) {
      where = 'WHERE estimate_id = $1';
      values.push(estimateId);
    }
    const { rows } = await fastify.pool.query(
      `SELECT id, estimate_id, source_kind, source_ref, status, error, model, created_by, created_at, updated_at
       FROM ai_jobs ${where} ORDER BY created_at DESC`,
      values,
    );
    return { data: rows };
  });

  // GET /api/ai/jobs/:id — задание с результатом (для прогресса/превью)
  fastify.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query('SELECT * FROM ai_jobs WHERE id = $1', [request.params.id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Задание не найдено' });
    return { data: rows[0] };
  });

  // POST /api/ai/jobs/:id/apply — применить готовый результат к смете
  // (используется UI и будущим встроенным маршрутом фазы 2).
  fastify.post<{ Params: { id: string } }>(
    '/jobs/:id/apply',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rows } = await fastify.pool.query('SELECT * FROM ai_jobs WHERE id = $1', [request.params.id]);
      const job = rows[0];
      if (!job) return reply.status(404).send({ error: 'Задание не найдено' });
      if (job.status === 'applied') return reply.status(409).send({ error: 'Задание уже применено' });

      const parsed = extractionResultSchema.safeParse(job.result);
      if (!parsed.success) return reply.status(400).send({ error: 'Результат задания отсутствует или некорректен' });

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const stats = await applyExtraction(
          client,
          { estimateId: job.estimate_id, aiJobId: job.id, sourceDocId: job.source_ref ?? null },
          parsed.data,
        );
        await client.query(`UPDATE ai_jobs SET status = 'applied' WHERE id = $1`, [job.id]);
        await client.query('COMMIT');
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
