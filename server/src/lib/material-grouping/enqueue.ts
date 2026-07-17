/**
 * Постановка заданий группировки — единственная точка создания.
 *
 * Результат один на смету и одинаков для всех. Ставится он ПО ОТКРЫТИЮ РАЗДЕЛА (ленивый вызов из
 * GET /jobs/latest), а не по правке сметы: прогон стоит токенов и минут, и платить за него имеет
 * смысл только когда результат кому-то нужен прямо сейчас. Правка сметы результат не пересчитывает,
 * а лишь помечает устаревшим (stale считается на лету по input_hash). «Пересчитать» у
 * администратора — тот же вызов с force.
 *
 * Не чаще раза в COOLDOWN_MS по смете: иначе получается петля — открытая вкладка досчитала, а
 * сметчик за эти минуты правил смету, и следующее чтение немедленно ставит новый полный прогон.
 *
 * Здесь же решается, что делать с уже существующим заданием. Правила:
 *   • готовый результат с тем же входом — ничего не делаем (это и есть кэш);
 *   • активное задание с тем же входом — считается ровно то, что нужно, ждём;
 *   • pending с другим входом — отменяем и ставим новое: расчёт ещё не начинался, терять нечего;
 *   • running с другим входом — НЕ трогаем. На LM Studio прогон идёт 10–25 минут, и правка сметы
 *     во время расчёта убивала бы его снова и снова — до конца он не досчитался бы никогда.
 *     Устаревший результат честно отдаётся как stale, а пересчитает его следующий заход.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { type GroupingSettings } from '@estimat/shared';
import { loadLlmRuntime, resolveLlmEndpoint } from '../llm/endpoint.js';
import { resolveAiModel, resolveGroupingLevels, resolveQwenNoThink } from '../llm/settings.js';
import { resolveAllPrompts } from '../llm/prompts.js';
import { computeEffectivePromptVersion, computeInputHash, computeScopeHash, loadGroupingLines } from './input.js';
import { PROMPT_VERSION } from './prompt.js';
import { abortGroupingJob, runGroupingJob } from './run.js';

/** Больше строк модель осмысленно не свяжет, а прогон растянется на часы. */
export const MAX_GROUPING_LINES = 1600;

/**
 * Минимальный интервал между автоматическими прогонами одной сметы. Ограничивает частоту ТРАТ, а не
 * свежесть результата: смету правят весь день, а каждый заход в раздел после правки — это полный
 * прогон всех наборов. Полчаса — тот возраст результата, который сметчику ещё не мешает.
 */
const COOLDOWN_MS = 30 * 60_000;

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
  | 'cooldown' // прошлый прогон слишком свежий: пересчитаем позже
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
  /** Заполняется только при reason='cooldown': когда автозапуск станет возможен снова. */
  retryAfter?: Date;
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

/**
 * Ждать ли до следующего автоматического прогона. Чистая функция — по тем же соображениям, что и
 * decideSuppression.
 *
 * Считаем от created_at, а не от updated_at: второй дёргает триггер на каждом UPDATE (heartbeat,
 * checkpoint), а нам нужен интервал между СТАРТАМИ прогонов.
 *
 * Только при готовом результате: есть что показать, спешить некуда. На dead/cancelled действуют
 * свои правила (decideSuppression), и подменять их задержкой нельзя — иначе законный повтор на
 * новом составе сметы ждал бы полчаса без причины.
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

/**
 * Запустить задание. Вход по завершении не перепроверяем: смета могла измениться, пока считали, но
 * это повод показать stale, а не начать новый прогон за спиной у пользователя — следующий заход в
 * раздел его и закажет.
 */
function startJob(fastify: FastifyInstance, jobId: string, estimateId: string): void {
  void runGroupingJob(fastify, jobId).catch((err) =>
    fastify.log.error({ err, jobId, estimateId }, 'material grouping: job run failed'),
  );
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
      const lastRow = last.rows[0] ?? null;
      const suppressedBy = decideSuppression(lastRow, pause.rowCount! > 0, inputHash);
      if (suppressedBy) result = { job: lastRow, reason: 'suppressed', suppressedBy };

      // Задержка — после подавления: остановленной вручную смете обещать «пересчитаем через 20
      // минут» нельзя, там пересчёта не будет вовсе.
      if (!result) {
        const retryAfter = decideCooldown(lastRow, Date.now(), COOLDOWN_MS);
        if (retryAfter) result = { job: lastRow, reason: 'cooldown', retryAfter };
      }
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
  // Идёт расчёт по устаревшему входу: пусть досчитает — результат отдастся как stale, а пересчёт
  // закажет следующий заход в раздел.
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

