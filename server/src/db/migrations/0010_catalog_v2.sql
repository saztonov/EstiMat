-- 0010: новый справочник работ и материалов (v2), собираемый из ВОР.
--   * Существующий справочник (rates, material_catalog) НЕ изменяется.
--   * Иерархия категорий/видов переиспользуется из действующего справочника
--     (FK на cost_categories через cost_types).
--   * rates_v2.legacy_rate_id — ссылка на подходящую расценку старого
--     справочника (match_kind: matched — точное совпадение, probable —
--     лучший кандидат, требует решения).
--   * rate_materials_v2 — ТОЛЬКО типовые материалы работы (повторяющиеся
--     более чем в половине проектов И более чем в половине ВОР этой работы);
--     редкие материалы в БД не заносятся (остаются в Excel для анализа).
-- Аддитивная и идемпотентная миграция.

-- ============================================================
-- 1. Новый справочник работ
-- ============================================================
CREATE TABLE IF NOT EXISTS rates_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_type_id UUID NOT NULL REFERENCES cost_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  legacy_rate_id UUID REFERENCES rates(id) ON DELETE SET NULL,
  match_kind TEXT CHECK (match_kind IN ('matched', 'probable')),
  source_projects INT NOT NULL DEFAULT 0,
  source_files INT NOT NULL DEFAULT 0,
  aliases JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cost_type_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rates_v2_cost_type_id   ON rates_v2(cost_type_id);
CREATE INDEX IF NOT EXISTS idx_rates_v2_legacy_rate_id ON rates_v2(legacy_rate_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rates_v2_updated_at') THEN
    CREATE TRIGGER trg_rates_v2_updated_at
      BEFORE UPDATE ON rates_v2
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. Новый справочник материалов
-- ============================================================
CREATE TABLE IF NOT EXISTS materials_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL,
  cost_type_id UUID REFERENCES cost_types(id) ON DELETE SET NULL,
  legacy_material_id UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
  source_projects INT NOT NULL DEFAULT 0,
  source_files INT NOT NULL DEFAULT 0,
  aliases JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_v2_cost_type_id ON materials_v2(cost_type_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_materials_v2_updated_at') THEN
    CREATE TRIGGER trg_materials_v2_updated_at
      BEFORE UPDATE ON materials_v2
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 3. Типовые материалы работы (только повторяющиеся в большинстве ВОР)
-- ============================================================
CREATE TABLE IF NOT EXISTS rate_materials_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_v2_id UUID NOT NULL REFERENCES rates_v2(id) ON DELETE CASCADE,
  material_v2_id UUID NOT NULL REFERENCES materials_v2(id) ON DELETE CASCADE,
  qty_ratio NUMERIC NOT NULL DEFAULT 1,
  files_count INT NOT NULL DEFAULT 0,
  projects_count INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rate_v2_id, material_v2_id)
);

CREATE INDEX IF NOT EXISTS idx_rate_materials_v2_rate_id     ON rate_materials_v2(rate_v2_id);
CREATE INDEX IF NOT EXISTS idx_rate_materials_v2_material_id ON rate_materials_v2(material_v2_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rate_materials_v2_updated_at') THEN
    CREATE TRIGGER trg_rate_materials_v2_updated_at
      BEFORE UPDATE ON rate_materials_v2
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
