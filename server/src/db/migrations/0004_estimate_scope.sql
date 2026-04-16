-- 0004: Категория затрат на уровне сметы, подрядчик на уровне раздела.
-- Идемпотентно: IF NOT EXISTS.

-- Смета: опциональная категория затрат.
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS cost_category_id UUID REFERENCES cost_categories(id) ON DELETE SET NULL;

-- Раздел: опциональный подрядчик-исполнитель.
ALTER TABLE estimate_sections
  ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- contractor_id на estimates оставляем для совместимости со старыми записями
-- (в UI/формах больше не используется; фактический исполнитель хранится на разделе).
