-- Справочник единиц измерения.
-- Засев — все единицы, уже встречающиеся в расценках, материалах и строках смет.

CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO units (name)
SELECT DISTINCT TRIM(unit) FROM (
  SELECT unit FROM rates
  UNION SELECT unit FROM material_catalog
  UNION SELECT unit FROM estimate_items
  UNION SELECT unit FROM estimate_materials
) u
WHERE TRIM(COALESCE(unit, '')) <> ''
ON CONFLICT (name) DO NOTHING;
