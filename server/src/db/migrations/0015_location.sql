-- 0015: локализация строк сметы — две независимые координаты:
--   * География — дерево зон объекта (корпус/парковка/стилобат/секция) с диапазоном
--     этажности на узле; этажи НЕ материализуются (диапазон floor_from..floor_to на строке).
--   * Тип помещения — глобальный справочник room_types + project_room_types (активные на объекте).
--   * estimate_items.zone_id / floor_from / floor_to / room_type_id — координаты строки (nullable
--     = «Весь объект / не указано»); copy_batch_id / copy_source_item_id — трассировка тиражирования.
-- Аддитивная и идемпотентная миграция. Существующие строки остаются без локации (NULL).

-- ============================================================
-- 1. Дерево зон объекта (корпуса/парковка/стилобат/секции)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES project_zones(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'building'
    CHECK (kind IN ('building', 'parking', 'stylobate', 'section', 'roof', 'other')),
  code TEXT,
  floor_min INT,                 -- нижний этаж диапазона (отрицательный — подземные)
  floor_max INT,                 -- верхний этаж; обе NULL — узел без этажности (парковка как единое целое)
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (floor_min IS NULL OR floor_max IS NULL OR floor_min <= floor_max)
);

CREATE INDEX IF NOT EXISTS idx_project_zones_project_id ON project_zones(project_id);
CREATE INDEX IF NOT EXISTS idx_project_zones_parent_id  ON project_zones(parent_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_zones_updated_at') THEN
    CREATE TRIGGER trg_project_zones_updated_at
      BEFORE UPDATE ON project_zones
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. Глобальный справочник типов помещений
-- ============================================================
CREATE TABLE IF NOT EXISTS room_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_room_types_updated_at') THEN
    CREATE TRIGGER trg_room_types_updated_at
      BEFORE UPDATE ON room_types
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Стартовый набор типов помещений (идемпотентно)
INSERT INTO room_types (name, sort_order) VALUES
  ('Квартира', 10),
  ('МОП коридор', 20),
  ('МОД холл', 30),
  ('Лестничная клетка', 40),
  ('Лифтовой холл', 50),
  ('Тех. помещение', 60),
  ('Кровля', 70),
  ('Парковочное место', 80),
  ('Кладовая', 90)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 3. Активные типы помещений на объекте (junction; настройка из карточки объекта)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_room_types (
  project_id   UUID NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  sort_order   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, room_type_id)
);

CREATE INDEX IF NOT EXISTS idx_project_room_types_project ON project_room_types(project_id);

-- ============================================================
-- 4. Координаты локации на строке работы (все nullable) + трассировка тиражирования
-- ============================================================
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS zone_id             UUID REFERENCES project_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS floor_from          INT,
  ADD COLUMN IF NOT EXISTS floor_to            INT,
  ADD COLUMN IF NOT EXISTS room_type_id        UUID REFERENCES room_types(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS copy_batch_id       UUID,
  ADD COLUMN IF NOT EXISTS copy_source_item_id UUID REFERENCES estimate_items(id) ON DELETE SET NULL;

-- Диапазон этажей: floor_from <= floor_to (когда оба заданы)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_estimate_items_floor_range') THEN
    ALTER TABLE estimate_items
      ADD CONSTRAINT chk_estimate_items_floor_range
      CHECK (floor_from IS NULL OR floor_to IS NULL OR floor_from <= floor_to);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimate_items_zone_id      ON estimate_items(zone_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_room_type_id ON estimate_items(room_type_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_copy_batch   ON estimate_items(copy_batch_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_loc          ON estimate_items(estimate_id, zone_id, room_type_id);
