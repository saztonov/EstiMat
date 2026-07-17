-- 0064: наблюдаемость умной группировки — журнал обмена с моделью и ручная остановка.
--
-- Зачем. Прогон группировки идёт минутами и целиком молчит: ни промпта, ни ответа, ни времени,
-- ни токенов не сохранялось нигде, а файловых логов у сервера нет (только docker logs). При
-- отказе провайдера админ видел «Обработано 0 из 57 наборов» и 0% — без единого признака того,
-- происходит ли что-нибудь. Журнал вызовов делает обмен видимым прямо в задаче.
--
-- Ручная остановка. Отмена задания хранилась только статусом 'cancelled', и этим же статусом
-- ensureEstimateGrouping помечает протухшее задание, которое сам же заменяет. Отличить волю
-- человека от служебной замены было нельзя, поэтому остановленный расчёт немедленно ставился
-- заново. Пауза вынесена в отдельную таблицу: это состояние СМЕТЫ, а не свойство задания —
-- задания чистятся retention'ом через 30 дней, а пауза обязана пережить чистку.
--
-- Аддитивная и идемпотентная миграция.

-- ---- ручная пауза группировки ------------------------------------------------

CREATE TABLE IF NOT EXISTS material_grouping_pauses (
  estimate_id UUID PRIMARY KEY REFERENCES estimates(id) ON DELETE CASCADE,
  paused_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Задание, которое останавливали: удаление задания retention'ом паузу не снимает.
  paused_job_id UUID REFERENCES material_grouping_jobs(id) ON DELETE SET NULL
);

COMMENT ON TABLE material_grouping_pauses IS
  'Ручная остановка группировки сметы. Снимается только успешным «Пересчитать» (force).';

-- ---- отличить ручную отмену от служебной -------------------------------------

ALTER TABLE material_grouping_jobs
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT
    CHECK (cancel_reason IS NULL OR cancel_reason IN ('manual', 'superseded')),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ---- журнал обмена с моделью -------------------------------------------------

CREATE TABLE IF NOT EXISTS material_grouping_llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES material_grouping_jobs(id) ON DELETE CASCADE,
  -- Попытка ЗАДАНИЯ (jobs.attempts) на момент вызова: после ретрая наборы считаются заново.
  attempt INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK (kind IN ('batch', 'merge')),
  batch_index INTEGER,
  partition_key TEXT,
  lines_count INTEGER,

  -- Запись создаётся ДО отправки запроса. Иначе журнал первые полторы минуты пуст, и вопрос
  -- «происходит хоть что-то?» остаётся без ответа — ровно та жалоба, ради которой он заведён.
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'waiting_slot', 'in_progress', 'succeeded', 'failed', 'timed_out',
                      'cancelled', 'empty')),

  -- Разбор — ось, независимая от транспорта: HTTP 200 может принести непригодный JSON, а пустой
  -- список групп ошибкой не является (ответ может состоять из одних общих/несгруппированных).
  parse_status TEXT NOT NULL DEFAULT 'not_run'
    CHECK (parse_status IN ('not_run', 'ok', 'warnings', 'failed')),
  parse_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  groups_count INTEGER,

  -- Тексты ровно те, что ушли в HTTP (включая /no_think, если он добавлялся). Не реконструировать
  -- позже: у наборов и слияния разные системные промпты, и совпадение не гарантировано.
  system_text TEXT,
  request_text TEXT,
  response_text TEXT,

  model TEXT,
  finish_reason TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,

  http_status INTEGER,
  -- Попытки транспорта: [{no, requestId, status, durationMs, retryDelayMs, errorBody}].
  -- У каждой свой X-Request-Id — по нему вызов сверяется с журналом прокси.
  http_attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE material_grouping_llm_calls IS
  'Журнал обмена с моделью по заданиям группировки. Только для админа, чистится через 7 дней.';

CREATE INDEX IF NOT EXISTS idx_mgllm_job ON material_grouping_llm_calls(job_id, started_at);
-- Чистка по возрасту.
CREATE INDEX IF NOT EXISTS idx_mgllm_created ON material_grouping_llm_calls(created_at);
