-- 0023: произвольные «типы» местоположения строки сметы.
-- Пользователь вводит тип свободным текстом (напр. «Тип 1») в поповере локации;
-- типы уникальны в рамках строительного объекта (проекта). Храним их в отдельной
-- таблице, а в выпадающем списке поповера показываем подходящие.
-- Уникальность — по нормализованному ключу name_norm = lower(btrim(name)),
-- чтобы « Тип 1 »/«тип 1»/«Тип 1» не плодили дубли.
-- estimate_items.location_type_id — FK на тип (один тип на всю работу).
-- Аддитивно и идемпотентно.

CREATE TABLE IF NOT EXISTS project_location_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_location_types_norm
  ON project_location_types(project_id, name_norm);

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS location_type_id UUID
  REFERENCES project_location_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_items_location_type
  ON estimate_items(location_type_id);
