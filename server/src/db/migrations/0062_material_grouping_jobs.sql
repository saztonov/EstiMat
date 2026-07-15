-- 0062: задания ИИ-группировки материалов сметы по производственным операциям.
--
-- Job record — по корпоративному стандарту v3.1 (раздел 16 «Фоновые задачи, retries и outbox»):
-- type/payload/status/attempts/max_attempts/next_run_at/locked_by/locked_until/last_error.
-- Захват задачи атомарный (UPDATE ... WHERE locked_until истёк ... RETURNING), поэтому прогон
-- переживает перезапуск сервера: на LM Studio смета в 577 позиций считается 10–25 минут, и
-- терять её из-за деплоя нельзя. Существующие ai_jobs этому канону не соответствуют и здесь
-- НЕ трогаются — их перевод отдельной задачей.
--
-- Статуса 'applied' нет: группировка — представление, в смету ничего не пишется.
-- Аддитивная и идемпотентная миграция.

CREATE TABLE IF NOT EXISTS material_grouping_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ---- канонический job record (стандарт v3.1) ----
  type TEXT NOT NULL DEFAULT 'material_grouping',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'ready', 'failed', 'cancelled', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ---- доменные поля ----
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Срез данных: у подрядчика материалы масштабированы по его доле и ограничены его работами,
  -- у сотрудника — полный объём (плюс отбор по подрядчикам). Общий кэш на смету показал бы
  -- чужие цифры. NULL = вид сотрудника.
  scope_org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  scope_hash TEXT NOT NULL,
  -- Хэш канонического входа: состав строк + количества + настройки + модель + версия промпта.
  -- Результат с другим хэшем нельзя молча считать актуальным.
  input_hash TEXT NOT NULL,
  -- Идемпотентность повторной отправки (двойной клик) — уникален в паре с автором.
  client_request_id UUID NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  input JSONB,
  batch_plan JSONB,
  -- Результаты уже посчитанных батчей: при повторе прогон продолжается, а не начинается заново.
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  batches_total INTEGER NOT NULL DEFAULT 0,
  batches_done INTEGER NOT NULL DEFAULT 0,
  result JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT,
  prompt_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_mgj_estimate ON material_grouping_jobs(estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mgj_status   ON material_grouping_jobs(status);
-- Выборка задач раннером: готовые к запуску и просроченные блокировки.
CREATE INDEX IF NOT EXISTS idx_mgj_claim    ON material_grouping_jobs(status, next_run_at)
  WHERE status IN ('pending', 'running');
-- Поиск кэша по входу.
CREATE INDEX IF NOT EXISTS idx_mgj_hash     ON material_grouping_jobs(estimate_id, scope_hash, input_hash);

-- Идемпотентность создания: повтор того же запроса не плодит задания.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mgj_client_request
  ON material_grouping_jobs(created_by, client_request_id);

-- Не более одного активного задания на срез: параллельные запуски одного и того же
-- сериализуются, а ready-результаты повтору НЕ мешают («Сформировать заново» должно работать).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mgj_active_scope
  ON material_grouping_jobs(estimate_id, scope_hash)
  WHERE status IN ('pending', 'running');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_material_grouping_jobs_updated_at') THEN
    CREATE TRIGGER trg_material_grouping_jobs_updated_at
      BEFORE UPDATE ON material_grouping_jobs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
