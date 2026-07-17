/**
 * Административная вкладка «Задания ИИ»: задачи трёх контуров в одном списке, журнал обмена с
 * моделью по каждой и сводная статистика расхода.
 *
 * Отдельный роут, а не расширение /api/ai: тот занят своим доменом (создание и применение
 * извлечения), а здесь сводятся ai_jobs, ai_chats и material_grouping_jobs. Класть сводку трёх
 * подсистем в роут одной из них — закреплять неверное «ai = ai_jobs».
 *
 * Список собирается тремя запросами и сливается в JS, а не одним UNION ALL: у веток разные
 * агрегаты (авторы ходов, наборы, добавленные позиции), и приведение их к общей форме прямо в SQL
 * превратило бы запрос в нечитаемый каскад приведений типов ради одного round-trip в админке.
 *
 * Удаления здесь нет намеренно: у чата оно отняло бы переписку у сметчика (архивную сессию
 * пользовательский список не показывает), у группировки — стёрло бы готовый результат, который
 * читает GET /jobs/latest, и следующий заход в смету запустил бы пересчёт на 10-25 минут.
 * Единственное удаление — существующее DELETE /api/ai/jobs/:id для терминальных заданий РД.
 */
import type { FastifyInstance } from 'fastify';
import {
  aiTaskListQuerySchema,
  aiTaskParamsSchema,
  aiTaskStatsQuerySchema,
  type AiTaskCallDetail,
  type AiTaskCallSummary,
  type AiTaskDetail,
  type AiTaskItem,
  type AiTaskKind,
  type AiTaskStats,
  type AiTaskStatsRow,
  type AiTaskStatus,
  type AiTaskTurn,
} from '@estimat/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { abortRun } from '../../lib/ai/run-registry.js';
import { abortGroupingJob } from '../../lib/material-grouping/run.js';
import {
  CHAT_STATUS_SQL,
  CHAT_TURN_FLAGS_SQL,
  callAggSql,
  normalizedStatusSql,
  qualifiedModelSql,
} from '../../lib/ai/task-sql.js';

/** Окно выборки по умолчанию. */
const DEFAULT_DAYS = 90;
/**
 * Предел на КАЖДЫЙ тип, а не на список целиком: группировка ставится автоматически при каждой
 * правке сметы, и общий предел вытеснил бы из выборки и РД, и чаты.
 */
const LIMIT_PER_KIND = 500;

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? '');

const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

/** Токены: NULL сохраняем — «провайдер не вернул usage» это не ноль. */
const num = (v: unknown): number | null => (v == null ? null : Number(v));

const SOURCE_LABELS: Record<string, string> = {
  rd_document: 'РД-документ',
  upload_md: 'Загрузка .md',
};

export default async function aiTasksRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  /** Вкладка целиком административная: здесь сырые промпты и данные всех смет. */
  const adminOnly = { preHandler: [requireRole('admin')] };

  const since = (days: number): string => {
    const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return d.toISOString();
  };

  // ---- список ---------------------------------------------------------------

  async function listMd(from: string): Promise<AiTaskItem[]> {
    const { rows } = await fastify.pool.query(
      `SELECT j.id, j.estimate_id, j.source_kind, j.source_ref, j.status, j.error, j.created_at,
              j.updated_at,
              ${qualifiedModelSql('j.model')}         AS model,
              ${normalizedStatusSql('j.status')}      AS status_norm,
              (j.result->'stats'->>'works')::int      AS works,
              (j.result->'stats'->>'materials')::int  AS materials,
              u.full_name AS user_name,
              p.name      AS project_name,
              agg.calls_total, agg.calls_ok, agg.prompt_tokens, agg.completion_tokens,
              agg.http_attempts, agg.duration_ms, agg.models
         FROM ai_jobs j
         LEFT JOIN users u     ON u.id = j.created_by
         LEFT JOIN estimates e ON e.id = j.estimate_id
         LEFT JOIN projects p  ON p.id = e.project_id
         LEFT JOIN LATERAL (${callAggSql('c.ai_job_id = j.id')}) agg ON true
        -- catalog_query исключён: это не задача, а запись о нажатии «Применить» в чате
        -- (lib/chat/apply.ts заводит её сразу в статусе applied, без единого вызова модели).
        -- В списке она была бы дублем строки сессии.
        WHERE j.source_kind <> 'catalog_query' AND j.created_at >= $1
        ORDER BY j.created_at DESC
        LIMIT ${LIMIT_PER_KIND}`,
      [from],
    );
    return rows.map((r): AiTaskItem => ({
      kind: 'md',
      id: r.id,
      title: r.source_ref?.trim() || 'Обработка MD',
      subtitle: SOURCE_LABELS[r.source_kind] ?? r.source_kind,
      status: r.status_norm as AiTaskStatus,
      rawStatus: r.status,
      estimateId: r.estimate_id,
      projectName: r.project_name,
      users: r.user_name ? [r.user_name] : [],
      models: r.models?.length ? r.models : r.model ? [r.model] : [],
      promptTokens: num(r.prompt_tokens),
      completionTokens: num(r.completion_tokens),
      callsOk: r.calls_ok ?? 0,
      callsTotal: r.calls_total ?? 0,
      httpAttempts: r.http_attempts ?? 0,
      durationMs: num(r.duration_ms),
      resultSummary:
        r.works != null || r.materials != null ? `Р: ${r.works ?? 0} · М: ${r.materials ?? 0}` : null,
      error: r.error,
      createdAt: iso(r.created_at),
      activityAt: iso(r.updated_at ?? r.created_at),
      hasFallback: false,
    }));
  }

  async function listChat(from: string): Promise<AiTaskItem[]> {
    const { rows } = await fastify.pool.query(
      `SELECT ch.id, ch.estimate_id, ch.title, ch.created_at,
              ${CHAT_STATUS_SQL}                      AS status_norm,
              t.has_running, t.has_failed, t.has_fallback, t.turns, t.last_at, t.last_error,
              t.user_names, t.models,
              p.name AS project_name,
              a.works, a.materials,
              agg.calls_total, agg.calls_ok, agg.prompt_tokens, agg.completion_tokens,
              agg.http_attempts, agg.duration_ms, agg.call_models
         FROM ai_chats ch
         -- Статус сессии — агрегат по ходам: см. CHAT_STATUS_SQL, «последний ход» врал бы.
         LEFT JOIN LATERAL (
           SELECT ${CHAT_TURN_FLAGS_SQL},
                  max(m.created_at) AS last_at,
                  (array_agg(m.error ORDER BY m.created_at DESC) FILTER (WHERE m.error IS NOT NULL))[1] AS last_error,
                  -- Сессия общая: доступ даёт смета, и ходы в ней могут быть от разных инженеров.
                  array_remove(array_agg(DISTINCT mu.full_name), NULL) AS user_names,
                  array_remove(array_agg(DISTINCT ${qualifiedModelSql('m.model')}), NULL) AS models
             FROM ai_chat_messages m
             LEFT JOIN users mu ON mu.id = m.created_by
            WHERE m.chat_id = ch.id AND m.role = 'assistant'
         ) t ON true
         -- «Добавлено» для чата: у ai_jobs нет chat_id, и связь с сессией существует только через
         -- estimate_items.ai_chat_id / estimate_materials.ai_chat_id (0013, оба проиндексированы).
         LEFT JOIN LATERAL (
           SELECT (SELECT count(*) FROM estimate_items     ei WHERE ei.ai_chat_id = ch.id)::int AS works,
                  (SELECT count(*) FROM estimate_materials em WHERE em.ai_chat_id = ch.id)::int AS materials
         ) a ON true
         LEFT JOIN LATERAL (
           SELECT agg2.calls_total, agg2.calls_ok, agg2.prompt_tokens, agg2.completion_tokens,
                  agg2.http_attempts, agg2.duration_ms, agg2.models AS call_models
             FROM (${callAggSql(
               `c.ai_chat_message_id IN (SELECT id FROM ai_chat_messages WHERE chat_id = ch.id)`,
             )}) agg2
         ) agg ON true
         LEFT JOIN estimates e ON e.id = ch.estimate_id
         LEFT JOIN projects p  ON p.id = e.project_id
        -- Сессии без единого хода ассистента — пустые болванки, задачей они не были.
        WHERE ch.created_at >= $1 AND t.turns > 0
        -- По последней активности: сессия живёт долго, и старая с новым ходом должна быть вверху.
        ORDER BY COALESCE(t.last_at, ch.created_at) DESC
        LIMIT ${LIMIT_PER_KIND}`,
      [from],
    );
    return rows.map((r): AiTaskItem => ({
      kind: 'chat',
      id: r.id,
      title: r.title?.trim() || 'Чат',
      subtitle: `${r.turns} ${plural(r.turns, 'ход', 'хода', 'ходов')}`,
      status: r.status_norm as AiTaskStatus,
      rawStatus: r.has_running ? 'running' : r.has_failed ? 'failed' : 'done',
      estimateId: r.estimate_id,
      projectName: r.project_name,
      users: r.user_names ?? [],
      models: r.call_models?.length ? r.call_models : (r.models ?? []),
      promptTokens: num(r.prompt_tokens),
      completionTokens: num(r.completion_tokens),
      callsOk: r.calls_ok ?? 0,
      callsTotal: r.calls_total ?? 0,
      httpAttempts: r.http_attempts ?? 0,
      durationMs: num(r.duration_ms),
      resultSummary:
        r.works || r.materials ? `Р: ${r.works ?? 0} · М: ${r.materials ?? 0}` : null,
      error: r.last_error,
      createdAt: iso(r.created_at),
      activityAt: iso(r.last_at ?? r.created_at),
      hasFallback: !!r.has_fallback,
    }));
  }

  async function listGrouping(from: string): Promise<AiTaskItem[]> {
    const { rows } = await fastify.pool.query(
      `SELECT g.id, g.estimate_id, g.status, g.last_error, g.created_at, g.updated_at,
              g.batches_done, g.batches_total,
              ${qualifiedModelSql('g.model')}    AS model,
              ${normalizedStatusSql('g.status')} AS status_norm,
              (g.result->'stats'->>'groups')::int AS groups,
              u.full_name AS user_name,
              p.name      AS project_name,
              agg.calls_total, agg.calls_ok, agg.prompt_tokens, agg.completion_tokens,
              agg.http_attempts, agg.duration_ms, agg.models
         FROM material_grouping_jobs g
         LEFT JOIN users u     ON u.id = g.created_by
         LEFT JOIN estimates e ON e.id = g.estimate_id
         LEFT JOIN projects p  ON p.id = e.project_id
         LEFT JOIN LATERAL (${callAggSql('c.material_grouping_job_id = g.id')}) agg ON true
        WHERE g.created_at >= $1
        ORDER BY g.created_at DESC
        LIMIT ${LIMIT_PER_KIND}`,
      [from],
    );
    return rows.map((r): AiTaskItem => ({
      kind: 'grouping',
      id: r.id,
      title: 'Умная группировка',
      subtitle:
        r.batches_total > 0 ? `${r.batches_done ?? 0} из ${r.batches_total} наборов` : null,
      status: r.status_norm as AiTaskStatus,
      rawStatus: r.status,
      estimateId: r.estimate_id,
      projectName: r.project_name,
      // created_by пуст у автоматических заданий: группировка идёт сама при правке сметы.
      // Клиент показывает «Система» — выдумывать инициатора нельзя.
      users: r.user_name ? [r.user_name] : [],
      models: r.models?.length ? r.models : r.model ? [r.model] : [],
      promptTokens: num(r.prompt_tokens),
      completionTokens: num(r.completion_tokens),
      callsOk: r.calls_ok ?? 0,
      callsTotal: r.calls_total ?? 0,
      httpAttempts: r.http_attempts ?? 0,
      durationMs: num(r.duration_ms),
      resultSummary: r.groups != null ? `${r.groups} ${plural(r.groups, 'группа', 'группы', 'групп')}` : null,
      error: r.last_error,
      createdAt: iso(r.created_at),
      activityAt: iso(r.updated_at ?? r.created_at),
      hasFallback: false,
    }));
  }

  /** GET /api/ai-tasks — задачи всех трёх контуров. */
  fastify.get('/', adminOnly, async (request) => {
    const q = aiTaskListQuerySchema.parse(request.query);
    const from = since(q.days ?? DEFAULT_DAYS);
    const [md, chat, grouping] = await Promise.all([listMd(from), listChat(from), listGrouping(from)]);
    const data = [...md, ...chat, ...grouping].sort((a, b) => b.activityAt.localeCompare(a.activityAt));
    return { data };
  });

  // ---- детали и журнал ------------------------------------------------------

  const CALL_PARENT: Record<AiTaskKind, string> = {
    md: 'c.ai_job_id = $1',
    grouping: 'c.material_grouping_job_id = $1',
    chat: 'c.ai_chat_message_id IN (SELECT id FROM ai_chat_messages WHERE chat_id = $1)',
  };

  async function loadTask(kind: AiTaskKind, id: string): Promise<AiTaskItem | null> {
    // Точечная выборка через тот же список: одна форма данных вместо второй, расходящейся с первой.
    const wide = since(3650);
    const all = kind === 'md' ? await listMd(wide) : kind === 'chat' ? await listChat(wide) : await listGrouping(wide);
    return all.find((t) => t.id === id) ?? null;
  }

  function mapCall(r: Record<string, unknown>): AiTaskCallSummary {
    const attempts = Array.isArray(r.http_attempts) ? r.http_attempts : [];
    return {
      id: r.id as string,
      kind: r.kind as string,
      turnId: (r.ai_chat_message_id as string) ?? null,
      attempt: (r.attempt as number) ?? 1,
      batchIndex: (r.batch_index as number) ?? null,
      status: r.status as AiTaskCallSummary['status'],
      parseStatus: r.parse_status as AiTaskCallSummary['parseStatus'],
      model: (r.model as string) ?? null,
      provider: (r.provider as string) ?? null,
      httpStatus: (r.http_status as number) ?? null,
      httpAttempts: attempts.length,
      promptTokens: num(r.prompt_tokens),
      completionTokens: num(r.completion_tokens),
      totalTokens: num(r.total_tokens),
      error: (r.error as string) ?? null,
      startedAt: iso(r.started_at),
      durationMs: num(r.duration_ms),
      textsPurged: r.texts_purged_at != null,
      requestPreview: (r.request_preview as string) || null,
      responsePreview: (r.response_preview as string) || null,
    };
  }

  /** GET /api/ai-tasks/:kind/:id — карточка задачи: сводка, ходы и журнал без тяжёлых текстов. */
  fastify.get('/:kind/:id', adminOnly, async (request, reply) => {
    const { kind, id } = aiTaskParamsSchema.parse(request.params);
    const task = await loadTask(kind, id);
    if (!task) return reply.status(404).send({ error: 'Задача не найдена' });

    // Тексты сюда не тянем: у задания РД вызовов сотни, и полные промпты дали бы мегабайты на
    // ответ. Превью хватает, чтобы узнать вызов, а целиком он грузится по клику.
    const { rows: callRows } = await fastify.pool.query(
      `SELECT id, kind, ai_chat_message_id, attempt, batch_index, status, parse_status, model,
              provider, http_status, http_attempts, prompt_tokens, completion_tokens, total_tokens,
              error, started_at, duration_ms, texts_purged_at,
              left(request_text, 200)  AS request_preview,
              left(response_text, 200) AS response_preview
         FROM ai_llm_calls c
        WHERE ${CALL_PARENT[kind]}
        ORDER BY started_at, id`,
      [id],
    );

    let turns: AiTaskTurn[] = [];
    if (kind === 'chat') {
      // Ходы: журнал сессии группируется по ним, иначе 8 вызовов одного ответа выглядят россыпью.
      const { rows } = await fastify.pool.query(
        `SELECT m.id, m.created_at, m.status, m.error, m.execution_mode,
                u.full_name AS user_name,
                (SELECT q.content FROM ai_chat_messages q
                  WHERE q.chat_id = m.chat_id AND q.role = 'user' AND q.created_at <= m.created_at
                  ORDER BY q.created_at DESC LIMIT 1) AS prompt
           FROM ai_chat_messages m
           LEFT JOIN users u ON u.id = m.created_by
          WHERE m.chat_id = $1 AND m.role = 'assistant'
          ORDER BY m.created_at`,
        [id],
      );
      turns = rows.map((r): AiTaskTurn => ({
        id: r.id,
        createdAt: iso(r.created_at),
        status: r.status,
        userName: r.user_name,
        executionMode: r.execution_mode,
        prompt: r.prompt,
        error: r.error,
      }));
    }

    const data: AiTaskDetail = { task, calls: callRows.map(mapCall), turns };
    reply.header('Cache-Control', 'no-store');
    return reply.send({ data });
  });

  /** GET /api/ai-tasks/calls/:callId — что именно ушло в модель и что она ответила. */
  fastify.get('/calls/:callId', adminOnly, async (request, reply) => {
    const { callId } = request.params as { callId: string };
    const { rows } = await fastify.pool.query(
      `SELECT *, left(request_text, 200) AS request_preview, left(response_text, 200) AS response_preview
         FROM ai_llm_calls WHERE id = $1`,
      [callId],
    );
    const r = rows[0];
    if (!r) return reply.status(404).send({ error: 'Вызов не найден' });
    const data: AiTaskCallDetail = {
      ...mapCall(r),
      systemText: r.system_text,
      requestText: r.request_text,
      responseText: r.response_text,
      finishReason: r.finish_reason,
      attempts: Array.isArray(r.http_attempts) ? r.http_attempts : [],
      parseWarnings: Array.isArray(r.parse_warnings) ? r.parse_warnings : [],
    };
    return reply.send({ data });
  });

  // ---- статистика -----------------------------------------------------------

  /** GET /api/ai-tasks/stats?days= — расход и успешность за период. */
  fastify.get('/stats', adminOnly, async (request) => {
    const q = aiTaskStatsQuerySchema.parse(request.query);
    const from = since(q.days);
    const to = new Date().toISOString();

    // Задачи и успешность — по трём таблицам; токены и модели — одним проходом по журналу.
    // Джойнить журнал на неограниченное множество задач ради тех же чисел незачем.
    const [tasksRes, callsRes] = await Promise.all([
      fastify.pool.query(
        `WITH t AS (
           SELECT 'md'::text AS kind, j.created_by, ${normalizedStatusSql('j.status')} AS status
             FROM ai_jobs j
            WHERE j.source_kind <> 'catalog_query' AND j.created_at >= $1
           UNION ALL
           SELECT 'chat', m.created_by, ${normalizedStatusSql('m.status')}
             FROM ai_chat_messages m
            WHERE m.role = 'assistant' AND m.created_at >= $1
           UNION ALL
           SELECT 'grouping', g.created_by, ${normalizedStatusSql('g.status')}
             FROM material_grouping_jobs g
            WHERE g.created_at >= $1
         )
         SELECT t.kind, t.created_by, u.full_name AS user_name, t.status, count(*)::int AS tasks
           FROM t LEFT JOIN users u ON u.id = t.created_by
          GROUP BY 1, 2, 3, 4`,
        [from],
      ),
      fastify.pool.query(
        `SELECT CASE
                  WHEN c.ai_job_id IS NOT NULL THEN 'md'
                  WHEN c.ai_chat_message_id IS NOT NULL THEN 'chat'
                  ELSE 'grouping'
                END AS kind,
                COALESCE(c.provider, 'unknown') || ':' || c.model AS model,
                m.created_by AS chat_user,
                count(*)::int                                     AS calls,
                count(*) FILTER (WHERE c.status <> 'succeeded')::int AS calls_failed,
                count(*) FILTER (WHERE c.total_tokens IS NULL)::int  AS calls_without_usage,
                sum(c.prompt_tokens)::bigint                      AS prompt_tokens,
                sum(c.completion_tokens)::bigint                  AS completion_tokens
           FROM ai_llm_calls c
           LEFT JOIN ai_chat_messages m ON m.id = c.ai_chat_message_id
          WHERE c.created_at >= $1
          GROUP BY 1, 2, 3`,
        [from],
      ),
    ]);

    const KIND_LABELS: Record<string, string> = {
      md: 'Обработка MD',
      chat: 'Чат',
      grouping: 'Умная группировка',
    };

    const totals: AiTaskStats['totals'] = {
      tasks: 0, succeeded: 0, failed: 0, running: 0,
      promptTokens: null, completionTokens: null,
      calls: 0, callsFailed: 0, callsWithoutUsage: 0,
    };
    const byKind = new Map<string, AiTaskStatsRow>();
    const byUser = new Map<string, AiTaskStatsRow>();
    const byModel = new Map<string, AiTaskStatsRow>();

    const row = (m: Map<string, AiTaskStatsRow>, key: string, label: string): AiTaskStatsRow => {
      let r = m.get(key);
      if (!r) {
        r = { key, label, tasks: 0, succeeded: 0, failed: 0, promptTokens: null, completionTokens: null, calls: 0 };
        m.set(key, r);
      }
      return r;
    };
    const addTokens = (r: { promptTokens: number | null; completionTokens: number | null }, p: unknown, c: unknown) => {
      if (p != null) r.promptTokens = (r.promptTokens ?? 0) + Number(p);
      if (c != null) r.completionTokens = (r.completionTokens ?? 0) + Number(c);
    };

    for (const t of tasksRes.rows) {
      const n = t.tasks as number;
      const ok = t.status === 'succeeded';
      const bad = t.status === 'failed' || t.status === 'dead';
      totals.tasks += n;
      if (ok) totals.succeeded += n;
      if (bad) totals.failed += n;
      if (t.status === 'running') totals.running += n;

      const k = row(byKind, t.kind, KIND_LABELS[t.kind] ?? t.kind);
      k.tasks += n;
      if (ok) k.succeeded += n;
      if (bad) k.failed += n;

      // created_by пуст у автоматической группировки — это «Система», а не безымянный пользователь.
      const uk = t.created_by ?? (t.kind === 'grouping' ? 'system' : 'unknown');
      const u = row(byUser, uk, t.user_name ?? (t.kind === 'grouping' ? 'Система' : 'Неизвестно'));
      u.tasks += n;
      if (ok) u.succeeded += n;
      if (bad) u.failed += n;
    }

    for (const c of callsRes.rows) {
      totals.calls += c.calls;
      totals.callsFailed += c.calls_failed;
      totals.callsWithoutUsage += c.calls_without_usage;
      addTokens(totals, c.prompt_tokens, c.completion_tokens);

      const k = row(byKind, c.kind, KIND_LABELS[c.kind] ?? c.kind);
      k.calls += c.calls;
      addTokens(k, c.prompt_tokens, c.completion_tokens);

      const m = row(byModel, c.model, c.model);
      m.calls += c.calls;
      addTokens(m, c.prompt_tokens, c.completion_tokens);
    }

    const sortRows = (m: Map<string, AiTaskStatsRow>): AiTaskStatsRow[] =>
      [...m.values()].sort((a, b) => (b.promptTokens ?? 0) + (b.completionTokens ?? 0) - ((a.promptTokens ?? 0) + (a.completionTokens ?? 0)) || b.tasks - a.tasks);

    const data: AiTaskStats = {
      from, to, totals,
      byKind: sortRows(byKind),
      byUser: sortRows(byUser),
      byModel: sortRows(byModel),
    };
    return { data };
  });

  // ---- остановка ------------------------------------------------------------

  /**
   * POST /api/ai-tasks/:kind/:id/cancel — остановить задачу.
   *
   * Идемпотентно (200 и на уже завершённой): в списке 409 на строке, которую только что закрыл
   * фоновый прогон, — раздражение, а не защита.
   */
  fastify.post('/:kind/:id/cancel', adminOnly, async (request, reply) => {
    const { kind, id } = aiTaskParamsSchema.parse(request.params);

    if (kind === 'md') {
      const upd = await fastify.pool.query(
        `UPDATE ai_jobs SET status = 'cancelled' WHERE id = $1 AND status IN ('pending', 'running') RETURNING id`,
        [id],
      );
      abortRun('md_extract', id);
      if (upd.rowCount === 0) {
        const { rows } = await fastify.pool.query('SELECT id FROM ai_jobs WHERE id = $1', [id]);
        if (!rows[0]) return reply.status(404).send({ error: 'Задание не найдено' });
      }
      return { data: { kind, id, status: 'cancelled' } };
    }

    if (kind === 'chat') {
      // У сессии активных ходов может быть несколько — гасим все.
      const { rows } = await fastify.pool.query(
        `UPDATE ai_chat_messages SET status = 'cancelled'
          WHERE chat_id = $1 AND status = 'running' RETURNING id`,
        [id],
      );
      for (const r of rows) abortRun('chat_turn', r.id);
      const { rows: chatRows } = await fastify.pool.query('SELECT id FROM ai_chats WHERE id = $1', [id]);
      if (!chatRows[0]) return reply.status(404).send({ error: 'Чат не найден' });
      return { data: { kind, id, status: 'cancelled' } };
    }

    const { rows } = await fastify.pool.query('SELECT id FROM material_grouping_jobs WHERE id = $1', [id]);
    if (!rows[0]) return reply.status(404).send({ error: 'Задание не найдено' });
    abortGroupingJob(id);
    // cancel_reason='manual' обязателен: им ensureEstimateGrouping отличает волю человека от
    // служебной замены и не ставит расчёт заново (0064).
    await fastify.pool.query(
      `UPDATE material_grouping_jobs
          SET status = 'cancelled', cancel_reason = 'manual', cancelled_at = now(), cancelled_by = $2,
              locked_by = NULL, locked_until = NULL
        WHERE id = $1 AND status IN ('pending', 'running')`,
      [id, request.currentUser.id],
    );
    return { data: { kind, id, status: 'cancelled' } };
  });
}

/** Русское склонение: 1 ход, 2 хода, 5 ходов. */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
