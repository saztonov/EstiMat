/**
 * Общий SQL для административной вкладки «Задания ИИ»: список и статистика смотрят на одни и те же
 * три таблицы и обязаны нормализовать их одинаково — иначе сводка разойдётся со списком.
 */

/**
 * Приведение статусов трёх подсистем к общему набору.
 *
 * Сырые значения между подсистемами не конфликтуют ('applied' только у ai_jobs, 'done' только у
 * чата, 'dead' только у группировки, 'pending' в обеих означает одно и то же), поэтому одного CASE
 * хватает на все три. Статус чат-СЕССИИ так не считается — он агрегат по ходам, см. CHAT_STATUS_SQL.
 */
export const normalizedStatusSql = (col: string): string => `
  CASE ${col}
    WHEN 'pending'   THEN 'queued'
    WHEN 'running'   THEN 'running'
    WHEN 'ready'     THEN 'succeeded'
    WHEN 'applied'   THEN 'succeeded'
    WHEN 'done'      THEN 'succeeded'
    WHEN 'failed'    THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'dead'      THEN 'dead'
    ELSE 'queued'
  END`;

/**
 * Статус чат-сессии по её ходам.
 *
 * Брать статус последнего хода нельзя: сессия, где половина ответов упала, а последний удался,
 * показалась бы полностью успешной. Отсюда partial — честный промежуточный исход.
 * Ожидает подзапрос с булевыми флагами (см. CHAT_TURN_FLAGS_SQL).
 */
export const CHAT_STATUS_SQL = `
  CASE
    WHEN t.has_running THEN 'running'
    WHEN t.has_done AND t.has_failed THEN 'partial'
    WHEN t.has_failed THEN 'failed'
    WHEN t.has_done THEN 'succeeded'
    WHEN t.has_cancelled THEN 'cancelled'
    ELSE 'queued'
  END`;

/** Флаги по ходам сессии — вход для CHAT_STATUS_SQL. */
export const CHAT_TURN_FLAGS_SQL = `
  bool_or(m.status = 'running')                        AS has_running,
  bool_or(m.status = 'done')                           AS has_done,
  bool_or(m.status = 'failed')                         AS has_failed,
  bool_or(m.status = 'cancelled')                      AS has_cancelled,
  bool_or(m.execution_mode = 'fallback')               AS has_fallback,
  count(*)::int                                        AS turns`;

/**
 * Квалифицированная модель 'provider:model'.
 *
 * Голый id — историческая запись чата (до 0065 туда писали model без провайдера). Дописать
 * 'openrouter:' было бы догадкой: у LM Studio id выглядит так же ('vendor/model'), и в аудите
 * выдуманный провайдер хуже честного «неизвестно».
 */
export const qualifiedModelSql = (col: string): string => `
  CASE
    WHEN ${col} IS NULL OR ${col} = '' THEN NULL
    WHEN position(':' in ${col}) > 0 THEN ${col}
    ELSE 'unknown:' || ${col}
  END`;

/**
 * Агрегат журнала по родителю: `predicate` цепляет вызовы к задаче (у чата это все ходы сессии).
 *
 * sum(tokens) без COALESCE(...,0) намеренно: NULL значит «провайдер не вернул usage», и подменять
 * это нулём — занижать расход молча.
 */
export const callAggSql = (predicate: string): string => `
  SELECT
    count(*)::int                                                   AS calls_total,
    count(*) FILTER (WHERE c.status = 'succeeded')::int             AS calls_ok,
    sum(c.prompt_tokens)::bigint                                    AS prompt_tokens,
    sum(c.completion_tokens)::bigint                                AS completion_tokens,
    COALESCE(sum(jsonb_array_length(c.http_attempts)), 0)::int      AS http_attempts,
    COALESCE(sum(c.duration_ms), 0)::bigint                         AS duration_ms,
    array_remove(array_agg(DISTINCT COALESCE(c.provider, 'unknown') || ':' || c.model), NULL) AS models
  FROM ai_llm_calls c
  WHERE ${predicate}`;
