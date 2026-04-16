-- EstiMat: раздел сметы теперь — пара (категория, вид затрат), а не расценка.
-- Идемпотентная миграция.

ALTER TABLE estimate_sections
  ADD COLUMN IF NOT EXISTS cost_type_id UUID REFERENCES cost_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_sections_cost_type_id
  ON estimate_sections(cost_type_id);

ALTER TABLE estimate_sections
  DROP COLUMN IF EXISTS rate_id;
