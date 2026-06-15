-- 0009: типовые материалы расценки + статус подтверждения материалов сметы.
--   * rate_materials — связь «расценка → типовые материалы» с коэффициентом расхода
--     на единицу работы (qty_ratio); заполняется импортом из ВОР (db:import-vor);
--   * estimate_materials.status — материалы, добавленные автоматически при добавлении
--     работы в смету, получают статус 'suggested' («предложение») и требуют
--     подтверждения (✓ → 'confirmed') либо удаления (✗).
-- Аддитивная и идемпотентная миграция.

-- ============================================================
-- 1. Типовые материалы расценки
-- ============================================================
CREATE TABLE IF NOT EXISTS rate_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_id UUID NOT NULL REFERENCES rates(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material_catalog(id) ON DELETE CASCADE,
  qty_ratio NUMERIC NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rate_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_rate_materials_rate_id     ON rate_materials(rate_id);
CREATE INDEX IF NOT EXISTS idx_rate_materials_material_id ON rate_materials(material_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rate_materials_updated_at') THEN
    CREATE TRIGGER trg_rate_materials_updated_at
      BEFORE UPDATE ON rate_materials
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. Статус материала в смете: suggested (предложение) / confirmed
-- ============================================================
ALTER TABLE estimate_materials
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'estimate_materials_status_check'
  ) THEN
    ALTER TABLE estimate_materials
      ADD CONSTRAINT estimate_materials_status_check
      CHECK (status IN ('suggested', 'confirmed'));
  END IF;
END $$;
