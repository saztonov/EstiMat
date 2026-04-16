-- EstiMat: разделы сметы, материалы-в-смете, цена материала, картинка проекта
-- Идемпотентная миграция: безопасно запускать повторно.

-- Цена у материала в каталоге
ALTER TABLE material_catalog
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Картинка строительного объекта
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Разделы сметы
CREATE TABLE IF NOT EXISTS estimate_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  rate_id UUID REFERENCES rates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimate_sections_estimate_id ON estimate_sections(estimate_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_sections_updated_at'
  ) THEN
    CREATE TRIGGER trg_estimate_sections_updated_at
      BEFORE UPDATE ON estimate_sections
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Позиции: раздел, тип позиции, связь с материалом
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES estimate_sections(id) ON DELETE CASCADE;

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'work';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'estimate_items_item_type_check'
      AND table_name = 'estimate_items'
  ) THEN
    ALTER TABLE estimate_items
      ADD CONSTRAINT estimate_items_item_type_check
      CHECK (item_type IN ('work','material'));
  END IF;
END $$;

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES material_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_items_section_id ON estimate_items(section_id);

-- Backfill: один «Без раздела» на каждую смету, у которой есть позиции без раздела
INSERT INTO estimate_sections (estimate_id, name, sort_order)
  SELECT DISTINCT ei.estimate_id, 'Без раздела', 0
    FROM estimate_items ei
    WHERE ei.section_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM estimate_sections s WHERE s.estimate_id = ei.estimate_id
      );

UPDATE estimate_items ei
  SET section_id = s.id
  FROM estimate_sections s
  WHERE ei.section_id IS NULL
    AND s.estimate_id = ei.estimate_id
    AND s.name = 'Без раздела';
