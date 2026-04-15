-- EstiMat: разделы сметы, материалы-в-смете, цена материала, картинка проекта

-- Цена у материала в каталоге
ALTER TABLE material_catalog
  ADD COLUMN unit_price NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Картинка строительного объекта
ALTER TABLE projects
  ADD COLUMN image_url TEXT;

-- Разделы сметы
CREATE TABLE estimate_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  rate_id UUID REFERENCES rates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_estimate_sections_estimate_id ON estimate_sections(estimate_id);

CREATE TRIGGER trg_estimate_sections_updated_at
  BEFORE UPDATE ON estimate_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Позиции: раздел, тип позиции, связь с материалом
ALTER TABLE estimate_items
  ADD COLUMN section_id UUID REFERENCES estimate_sections(id) ON DELETE CASCADE,
  ADD COLUMN item_type TEXT NOT NULL DEFAULT 'work'
    CHECK (item_type IN ('work','material')),
  ADD COLUMN material_id UUID REFERENCES material_catalog(id) ON DELETE SET NULL;

CREATE INDEX idx_estimate_items_section_id ON estimate_items(section_id);

-- Backfill: один «Без раздела» для существующих смет с позициями
INSERT INTO estimate_sections (estimate_id, name, sort_order)
  SELECT DISTINCT estimate_id, 'Без раздела', 0 FROM estimate_items;

UPDATE estimate_items ei
  SET section_id = (SELECT id FROM estimate_sections s
                    WHERE s.estimate_id = ei.estimate_id LIMIT 1)
  WHERE section_id IS NULL;
