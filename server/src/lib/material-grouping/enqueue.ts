/**
 * Постановка заданий группировки — единственная точка создания.
 *
 * Группировка безусловна: результат один на смету, ставится сам (назначение подрядчика,
 * изменение состава сметы) и одинаков для всех. Пользователь её не запускает — «Пересчитать»
 * у администратора это тот же вызов с force.
 *
 * Здесь же решается, что делать с уже существующим заданием. Правила:
 *   • готовый результат с тем же входом — ничего не делаем (это и есть кэш);
 *   • активное задание с тем же входом — считается ровно то, что нужно, ждём;
 *   • pending с другим входом — отменяем и ставим новое: расчёт ещё не начинался, терять нечего;
 *   • running с другим входом — НЕ трогаем. На LM Studio прогон идёт 10–25 минут, и правка сметы
 *     во время расчёта убивала бы его снова и снова — до конца он не досчитался бы никогда.
 *     Вместо этого по завершении прогона проверяем вход ещё раз (startJob) и ставим новое.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { type EstimateChangeReason, type GroupingSettings } from '@estimat/shared';
import { loadLlmRuntime, resolveLlmEndpoint } from '../llm/endpoint.js';
import { resolveAiModel, resolveGroupingLevels, resolveQwenNoThink } from '../llm/settings.js';
import { resolveAllPrompts } from '../llm/prompts.js';
import { computeEffectivePromptVersion, computeInputHash, computeScopeHash, loadGroupingLines } from './input.js';
import { PROMPT_VERSION } from './prompt.js';
import { abortGroupingJob, runGroupingJob } from './run.js';

/** Больше строк модель осмысленно не свяжет, а прогон растянется на часы. */
export const MAX_GROUPING_LINES = 1600;

/**
 * Причины изменения сметы, способные поменять вход группировки (состав материалов, работы,
 * местоположение, назначения). Дешёвый первый отсев: комментарии и переименование сметы на
 * группы не влияют, и гонять из-за них тяжёлый запрос состава незачем.
 *
 * Точный ответ всё равно даёт input_hash внутри ensureEstimateGrouping — этот список лишь
 * отбрасывает заведомо бесполезные поводы.
 */
const RELEVANT_REASONS = new Set<EstimateChangeReason>([
  'item_created',
  'item_updated',
  'item_deleted',
  'material_created',
  'material_updated',
  'material_deleted',
  'materials_reassigned',
  'bulk_deleted',
  'confirmed_all',
  'contractor_set',
  'contractor_cleared',
  'ai_applied',
  'items_replicated',
  'undo_applied',
  'vor_created',
  'vor_deleted',
]);

export const affectsGrouping = (reason: EstimateChangeReason): boolean => RELEVANT_REASONS.has(reason);

/** Массовое редактирование не должно ставить задание после каждой строки. */
const DEBOUNCE_MS = 15_000;

export interface GroupingJobRow {
  id: string;
  estimate_id: string;
  status: string;
  settings: GroupingSettings;
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
  | 'created' // поставлено новое задание
  | 'cached' // готовый результат с тем же входом
  | 'active' // уже считается
  | 'suppressed' // остановлено человеком либо исчерпаны попытки на этом же входе
  | 'disabled' // ИИ-провайдер не настроен
  | 'empty' // в смете нет материалов
  | 'too_many'; // строк больше лимита

/** Почему автоматической постановки не будет. Панель обязана сказать это прямо. */
export type SuppressedBy = 'manual_stop' | 'terminal_failure';

export interface EnsureResult {
  job: GroupingJobRow | null;
  reason: EnsureReason;
  /** Заполняется только при reason='suppressed'. */
  suppressedBy?: SuppressedBy;
}

/**
 * Ставить ли расчёт автоматически. Чистая функция: решение важное, а протестировать его на живой
 * БД в этом проекте негде.
 *
 * Ручная остановка держится ПО СМЕТЕ, вход игнорируется: «Остановить» нажимают, когда шлюз
 * штормит, и правка сметы не должна возобновлять шторм. Снимает её только «Пересчитать» (force),
 * который сюда не заходит.
 *
 * Исчерпание попыток (dead) держится только на ТОМ ЖЕ входе: шлюз мог починиться, и новый состав
 * сметы — законный повод попробовать снова. Иначе один шторм убил бы группировку сметы навсегда.
 *
 * Служебная отмена (cancel_reason='superseded' — это decideOnActive заменяет протухшее задание)
 * не подавляет ничего: её делает сам сервер, а не человек.
 *
 * Статуса 'failed' здесь намеренно нет: раннер его не пишет — при неудаче задание остаётся
 * 'pending' до max_attempts, а затем становится 'dead' (см. run.ts).
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

const pendingTimers = new Map<string, NodeJS.Timeout>();

/**
 * Запустить задание и по завершении сверить вход ещё раз: пока считали, смету могли поправить
 * (running мы намеренно не убиваем). Повтор ставим только после успешного прогона — иначе
 * упавшее задание порождало бы новое бесконечно.
 */
function startJob(fastify: FastifyInstance, jobId: string, estimateId: string): void {
  void (async () => {
    try {
      await runGroupingJob(fastify, jobId);
      const { rows } = await fastify.pool.query<{ status: string }>(
        'SELECT status FROM material_grouping_jobs WHERE id = $1',
        [jobId],
      );
      if (rows[0]?.status !== 'ready') return;
      await ensureEstimateGrouping(fastify, estimateId, { actorUserId: null });
    } catch (err) {
      fastify.log.error({ err, jobId, estimateId }, 'material grouping: job run failed');
    }
  })();
}

/**
 * Поставить/обновить группировку сметы, если это нужно. Идемпотентна и безопасна к параллельным
 * вызовам: решение принимается под advisory-lock на смету (уникальный индекс uq_mgj_active_scope
 * остаётся страховкой, но сам по себе он не мешает потерять актуальный вход).
 */
export async function ensureEstimateGrouping(
  fastify: FastifyInstance,
  estimateId: string,
  opts: { actorUserId: string | null; force?: boolean },
): Promise<EnsureResult> {
  // Дешёвый отсев до тяжёлой подготовки: на остановленной смете чтение состава и резолв промптов
  // не нужны, а клиент во время расчёта поллит раз в 1.5 с. Решение всё равно перепроверяется под
  // advisory-lock ниже — здесь только экономия.
  if (!opts.force) {
    const { rowCount } = await fastify.pool.query('SELECT 1 FROM material_grouping_pauses WHERE estimate_id = $1', [
      estimateId,
    ]);
    if (rowCount! > 0) {
      // Тот же фильтр по scope_hash, что и в транзакции ниже: иначе сюда попадёт задание старого
      // среза (до перехода на общий результат scope_hash считался от сметы+организации+отбора), и
      // панель показала бы ошибку чужого прогона.
      const { rows } = await fastify.pool.query<GroupingJobRow>(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2
          ORDER BY created_at DESC LIMIT 1`,
        [estimateId, computeScopeHash(estimateId)],
      );
      return { job: rows[0] ?? null, reason: 'suppressed', suppressedBy: 'manual_stop' };
    }
  }

  // Задание не создаём вовсе: иначе останется вечный pending, который не подберёт даже watchdog
  // (так устроены ai_jobs — здесь этот паттерн не повторяем).
  const qualifiedModel = await resolveAiModel(fastify.pool);
  const ep = resolveLlmEndpoint(qualifiedModel, await loadLlmRuntime(fastify.pool));
  if (!ep.enabled) return { job: null, reason: 'disabled' };

  const lines = await loadGroupingLines(fastify.pool, estimateId);
  if (lines.length === 0) return { job: null, reason: 'empty' };
  if (lines.length > MAX_GROUPING_LINES) return { job: null, reason: 'too_many' };

  // Снимок промптов/режима фиксируется на момент создания: input_hash, первый прогон и
  // resume/retry обязаны работать на одном и том же тексте. Правка промпта из администрирования
  // влияет только на новые задания.
  const settings = await resolveGroupingLevels(fastify.pool);
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
  const inputHash = computeInputHash(lines, settings, qualifiedModel, promptVersion);
  const scopeHash = computeScopeHash(estimateId);

  const client = await fastify.pool.connect();
  let created: GroupingJobRow | null = null;
  let result: EnsureResult | null = null;
  try {
    await client.query('BEGIN');
    // Сериализуем «прочитать → решить → вставить»: два параллельных назначения не должны ни
    // продублировать задание, ни потерять актуальный вход.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [estimateId]);

    if (!opts.force) {
      const cached = await client.query<GroupingJobRow>(
        `SELECT * FROM material_grouping_jobs
          WHERE estimate_id = $1 AND scope_hash = $2 AND input_hash = $3 AND status = 'ready'
          ORDER BY created_at DESC LIMIT 1`,
        [estimateId, scopeHash, inputHash],
      );
      if (cached.rows[0]) result = { job: cached.rows[0], reason: 'cached' };
    }

    // Проверка подавления строго ДО decideOnActive: тот отменяет протухшее задание и рассчитывает,
    // что следом будет INSERT. Проверка после него увидела бы эту отмену в своей же транзакции и
    // залипла бы навсегда, не создав задание.
    if (!result && !opts.force) {
      const [pause, last] = await Promise.all([
        client.query(`SELECT 1 FROM material_grouping_pauses WHERE estimate_id = $1`, [estimateId]),
        client.query<GroupingJobRow>(
          `SELECT * FROM material_grouping_jobs
            WHERE estimate_id = $1 AND scope_hash = $2
            ORDER BY created_at DESC LIMIT 1`,
          [estimateId, scopeHash],
        ),
      ]);
      const suppressedBy = decideSuppression(last.rows[0] ?? null, pause.rowCount! > 0, inputHash);
      if (suppressedBy) result = { job: last.rows[0] ?? null, reason: 'suppressed', suppressedBy };
    }

    if (!result) {
      const decided = await decideOnActive(client, { estimateId, scopeHash, inputHash, force: opts.force });
      if (decided) result = decided;
    }

    if (!result) {
      const ins = await client.query<GroupingJobRow>(
        `INSERT INTO material_grouping_jobs
           (estimate_id, created_by, scope_org_id, scope_hash, input_hash, client_request_id,
            settings, payload, input, model, prompt_version)
         VALUES ($1, $2, NULL, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
         RETURNING *`,
        [
          estimateId,
          opts.actorUserId,
          scopeHash,
          inputHash,
          randomUUID(),
          JSON.stringify(settings),
          JSON.stringify({ snapshot }),
          JSON.stringify({ lines: lines.length }),
          `${ep.provider}:${ep.model}`,
          promptVersion,
        ],
      );
      created = ins.rows[0] ?? null;
      result = { job: created, reason: 'created' };
      // Паузу снимает только успешная постановка и только в одной транзакции с ней: при откате
      // вставки остановка обязана сохраниться, иначе «Пересчитать» с ошибкой молча возобновил бы
      // автоматические прогоны.
      await client.query('DELETE FROM material_grouping_pauses WHERE estimate_id = $1', [estimateId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // uq_mgj_active_scope: параллельный вызов из другого процесса успел раньше — это не ошибка.
    if ((err as { code?: string })?.code === '23505') return { job: null, reason: 'active' };
    throw err;
  } finally {
    client.release();
  }

  // Раннер запускаем только после COMMIT: до него claim не увидит строку.
  if (created) startJob(fastify, created.id, estimateId);
  return result;
}

/** Что делать с активным заданием. null — активного нет либо оно снято, можно вставлять новое. */
async function decideOnActive(
  client: PoolClient,
  ctx: { estimateId: string; scopeHash: string; inputHash: string; force?: boolean },
): Promise<EnsureResult | null> {
  const { rows } = await client.query<GroupingJobRow>(
    `SELECT * FROM material_grouping_jobs
      WHERE estimate_id = $1 AND scope_hash = $2 AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.estimateId, ctx.scopeHash],
  );
  const active = rows[0];
  if (!active) return null;

  if (!ctx.force && active.input_hash === ctx.inputHash) return { job: active, reason: 'active' };
  // Идёт расчёт по устаревшему входу: досчитает и сам перепроверит вход (startJob).
  if (!ctx.force && active.status === 'running') return { job: active, reason: 'active' };

  // force — админ попросил явно; либо pending по устаревшему входу — расчёт ещё не начинался.
  // Отмена служебная: её делает сервер, заменяя задание, и держать из-за неё паузу нельзя —
  // отсюда cancel_reason, отличающий её от «Остановить» (см. decideSuppression).
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

/**
 * Отложенная проверка после изменения сметы. Собирает всплеск правок в один вызов: при массовом
 * редактировании иначе ставилось бы задание на каждую строку. Сам ensure дешёвых поводов не
 * боится — если вход не изменился, до модели дело не дойдёт.
 */
export function cancelScheduledRefresh(estimateId: string): void {
  const timer = pendingTimers.get(estimateId);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(estimateId);
}

export function scheduleGroupingRefresh(fastify: FastifyInstance, estimateId: string): void {
  const existing = pendingTimers.get(estimateId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(estimateId);
    void ensureEstimateGrouping(fastify, estimateId, { actorUserId: null }).catch((err) =>
      fastify.log.warn({ err, estimateId }, 'material grouping: scheduled refresh failed'),
    );
  }, DEBOUNCE_MS);
  timer.unref();
  pendingTimers.set(estimateId, timer);
}
