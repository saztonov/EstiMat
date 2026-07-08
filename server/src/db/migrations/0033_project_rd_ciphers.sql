-- 0033: справочник шифров рабочей документации (РД) на объект.
--   * Шифр (напр. «133_23-ГК-ЭО1») привязан к КОНКРЕТНОМУ объекту (project_id).
--   * ON DELETE CASCADE: удалили объект → его шифры удалились.
--   * UNIQUE(project_id, code): один и тот же шифр не заводится дважды на объект.
--   * Порядок в UI не управляется — выборка сортируется по code (алфавитно).
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

CREATE TABLE IF NOT EXISTS project_rd_ciphers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_project_rd_ciphers_project
  ON project_rd_ciphers (project_id);

-- Авто-обновление updated_at при редактировании (общая функция из 0001).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_rd_ciphers_updated_at') THEN
    CREATE TRIGGER trg_project_rd_ciphers_updated_at
      BEFORE UPDATE ON project_rd_ciphers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
