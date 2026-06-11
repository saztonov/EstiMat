-- 0011: ИИ-извлечение работ/материалов из рабочей документации (РД).
--   * ai_jobs — задания агента (вход/статус/результат) для UI и трассировки.
--   * estimate_items / estimate_materials — поля трассировки источника позиции
--     (source, ai_job_id, confidence, needs_review, source_doc_id, source_snippet),
--     чтобы отличать добавленное ИИ и фильтровать «несогласованные» прямо в смете.
-- Аддитивная и идемпотентная миграция.

-- ============================================================
-- 1. Задания ИИ-извлечения
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('rd_document', 'upload_md', 'catalog_query')),
  source_ref TEXT,
  input JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'ready', 'applied', 'failed')),
  result JSONB,
  error TEXT,
  model TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_estimate_id ON ai_jobs(estimate_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status      ON ai_jobs(status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_jobs_updated_at') THEN
    CREATE TRIGGER trg_ai_jobs_updated_at
      BEFORE UPDATE ON ai_jobs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. Поля трассировки источника в работах сметы
-- ============================================================
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai', 'catalog')),
  ADD COLUMN IF NOT EXISTS ai_job_id UUID REFERENCES ai_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_doc_id TEXT,
  ADD COLUMN IF NOT EXISTS source_snippet TEXT;

CREATE INDEX IF NOT EXISTS idx_estimate_items_ai_job_id ON estimate_items(ai_job_id);

-- ============================================================
-- 3. Поля трассировки источника в материалах сметы
-- ============================================================
ALTER TABLE estimate_materials
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai', 'catalog')),
  ADD COLUMN IF NOT EXISTS ai_job_id UUID REFERENCES ai_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_doc_id TEXT,
  ADD COLUMN IF NOT EXISTS source_snippet TEXT;

CREATE INDEX IF NOT EXISTS idx_estimate_materials_ai_job_id ON estimate_materials(ai_job_id);
