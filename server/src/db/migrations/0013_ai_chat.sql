-- 0013: ИИ-ассистент сметчика в режиме «Чат».
--   * pg_trgm + expression GIN-индексы (lower(...)) для нечёткого поиска работ/
--     материалов в справочнике и похожих позиций в сметах других объектов.
--   * ai_chats / ai_chat_messages — сессии и сообщения чата (живой прогресс агента).
--   * estimate_items / estimate_materials — колонка ai_chat_id для связи добавленной
--     агентом позиции с сессией чата (аудит-связь, не отменяет ai_job_id).
-- Аддитивная и идемпотентная миграция.

-- ============================================================
-- 1. Нечёткий поиск (pg_trgm)
-- ============================================================
-- Расширение доступно на Managed PostgreSQL. Применяется пользователем с
-- write-доступом. Если у роли нет прав — этот шаг упадёт; поиск тогда деградирует
-- на ILIKE + TS-rescoring (стартап-чек hasPgTrgm в server/src/lib/chat/search.ts).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Expression-индексы по lower(...): запросы ассистента используют lower(name)/
-- lower(description), чтобы поиск был регистронезависимым.
CREATE INDEX IF NOT EXISTS idx_rates_name_trgm
  ON rates USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rates_v2_name_trgm
  ON rates_v2 USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_materials_v2_name_trgm
  ON materials_v2 USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_material_catalog_name_trgm
  ON material_catalog USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_estimate_items_desc_trgm
  ON estimate_items USING gin (lower(description) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_estimate_materials_desc_trgm
  ON estimate_materials USING gin (lower(description) gin_trgm_ops);

-- ============================================================
-- 2. Сессии чата
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chats_estimate_id ON ai_chats(estimate_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_chats_updated_at') THEN
    CREATE TRIGGER trg_ai_chats_updated_at
      BEFORE UPDATE ON ai_chats
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 3. Сообщения чата
-- ============================================================
-- role ограничена user|assistant: протокол tool-вызовов агента хранится в
-- steps (JSONB), карточки-предложения — в cards (JSONB). model пишется на
-- каждое сообщение (настройка модели может меняться между сообщениями).
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  status TEXT NOT NULL DEFAULT 'done'
    CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  content TEXT,
  model TEXT,
  steps JSONB,
  cards JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_chat_id ON ai_chat_messages(chat_id, created_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_chat_messages_updated_at') THEN
    CREATE TRIGGER trg_ai_chat_messages_updated_at
      BEFORE UPDATE ON ai_chat_messages
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 4. Связь добавленных агентом позиций с сессией чата
-- ============================================================
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS ai_chat_id UUID REFERENCES ai_chats(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_estimate_items_ai_chat_id ON estimate_items(ai_chat_id);

ALTER TABLE estimate_materials
  ADD COLUMN IF NOT EXISTS ai_chat_id UUID REFERENCES ai_chats(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_estimate_materials_ai_chat_id ON estimate_materials(ai_chat_id);
