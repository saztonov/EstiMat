-- 0005: строко-центричная модель смет.
--   * измерения объекта/категории/вида затрат пишутся прямо в строку работы (estimate_items);
--   * подрядчик выносится в отдельную таблицу-связку estimate_contractors (смета + вид затрат);
--   * материалы выносятся в отдельную таблицу estimate_materials, привязанную к строке работы;
--   * итог сметы пересчитывается как работы + материалы.
-- Аддитивная и идемпотентная миграция (разделы estimate_sections удаляются в 0006).

-- ============================================================
-- 1. Измерения на строке работы
-- ============================================================
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS cost_category_id UUID REFERENCES cost_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_type_id     UUID REFERENCES cost_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_items_project_id       ON estimate_items(project_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_cost_category_id ON estimate_items(cost_category_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_cost_type_id     ON estimate_items(cost_type_id);

-- ============================================================
-- 2. Подрядчик на вид затрат (отдельная таблица-связка)
-- ============================================================
CREATE TABLE IF NOT EXISTS estimate_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  cost_type_id UUID NOT NULL REFERENCES cost_types(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (estimate_id, cost_type_id)
);

CREATE INDEX IF NOT EXISTS idx_estimate_contractors_estimate_id  ON estimate_contractors(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_contractors_cost_type_id ON estimate_contractors(cost_type_id);
CREATE INDEX IF NOT EXISTS idx_estimate_contractors_contractor_id ON estimate_contractors(contractor_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_contractors_updated_at') THEN
    CREATE TRIGGER trg_estimate_contractors_updated_at
      BEFORE UPDATE ON estimate_contractors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 3. Материалы под работами (отдельная таблица)
-- ============================================================
CREATE TABLE IF NOT EXISTS estimate_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES estimate_items(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  material_id UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimate_materials_item_id     ON estimate_materials(item_id);
CREATE INDEX IF NOT EXISTS idx_estimate_materials_estimate_id ON estimate_materials(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_materials_material_id ON estimate_materials(material_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_materials_updated_at') THEN
    CREATE TRIGGER trg_estimate_materials_updated_at
      BEFORE UPDATE ON estimate_materials
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 4. Пересчёт итога сметы: работы + материалы
-- ============================================================
CREATE OR REPLACE FUNCTION recalc_estimate_total() RETURNS TRIGGER AS $$
BEGIN
  UPDATE estimates SET
    total_amount =
      (SELECT COALESCE(SUM(total), 0) FROM estimate_items
         WHERE estimate_id = COALESCE(NEW.estimate_id, OLD.estimate_id))
    + (SELECT COALESCE(SUM(total), 0) FROM estimate_materials
         WHERE estimate_id = COALESCE(NEW.estimate_id, OLD.estimate_id)),
    updated_at = now()
  WHERE id = COALESCE(NEW.estimate_id, OLD.estimate_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- триггер пересчёта на материалах (trg_estimate_recalc на estimate_items уже есть из 0001)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_materials_recalc') THEN
    CREATE TRIGGER trg_estimate_materials_recalc
      AFTER INSERT OR UPDATE OR DELETE ON estimate_materials
      FOR EACH ROW EXECUTE FUNCTION recalc_estimate_total();
  END IF;
END $$;

-- ============================================================
-- 5. Backfill: подрядчики из разделов → estimate_contractors
-- ============================================================
INSERT INTO estimate_contractors (estimate_id, cost_type_id, contractor_id)
SELECT DISTINCT ON (s.estimate_id, s.cost_type_id)
       s.estimate_id, s.cost_type_id, s.contractor_id
FROM estimate_sections s
WHERE s.contractor_id IS NOT NULL
  AND s.cost_type_id IS NOT NULL
ORDER BY s.estimate_id, s.cost_type_id, s.created_at
ON CONFLICT (estimate_id, cost_type_id) DO NOTHING;

-- ============================================================
-- 6. Backfill: перенос материалов из estimate_items → estimate_materials.
--    Родитель материала — ближайшая предшествующая работа того же раздела,
--    иначе первая работа сметы. Материалы без работы остаются (редкий легаси-кейс).
-- ============================================================
DROP TABLE IF EXISTS _mat_move_0005;
CREATE TEMP TABLE _mat_move_0005 AS
SELECT m.id,
  COALESCE(
    (SELECT w.id FROM estimate_items w
       WHERE w.estimate_id = m.estimate_id
         AND w.section_id IS NOT DISTINCT FROM m.section_id
         AND w.item_type = 'work'
         AND (w.sort_order, w.created_at) <= (m.sort_order, m.created_at)
       ORDER BY w.sort_order DESC, w.created_at DESC
       LIMIT 1),
    (SELECT w.id FROM estimate_items w
       WHERE w.estimate_id = m.estimate_id
         AND w.item_type = 'work'
       ORDER BY w.sort_order, w.created_at
       LIMIT 1)
  ) AS parent_id
FROM estimate_items m
WHERE m.item_type = 'material';

INSERT INTO estimate_materials
  (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, created_at, updated_at)
SELECT mv.parent_id, ei.estimate_id, ei.material_id, ei.description, ei.quantity, ei.unit,
       ei.unit_price, ei.sort_order, ei.created_at, ei.updated_at
FROM _mat_move_0005 mv
JOIN estimate_items ei ON ei.id = mv.id
WHERE mv.parent_id IS NOT NULL;

DELETE FROM estimate_items WHERE id IN (SELECT id FROM _mat_move_0005 WHERE parent_id IS NOT NULL);

DROP TABLE IF EXISTS _mat_move_0005;

-- ============================================================
-- 7. Backfill: измерения для оставшихся строк (работ)
-- ============================================================
UPDATE estimate_items ei SET
  project_id = (SELECT e.project_id FROM estimates e WHERE e.id = ei.estimate_id),
  cost_type_id = (SELECT s.cost_type_id FROM estimate_sections s WHERE s.id = ei.section_id),
  cost_category_id = COALESCE(
    (SELECT ct.category_id FROM estimate_sections s
       JOIN cost_types ct ON s.cost_type_id = ct.id
       WHERE s.id = ei.section_id),
    (SELECT e.cost_category_id FROM estimates e WHERE e.id = ei.estimate_id)
  );

-- ============================================================
-- 8. Триггер синхронизации измерений строки (после backfill)
--    project_id ← смета; cost_category_id ← категория вида затрат строки
--    (fallback — категория сметы). cost_type_id задаётся вызывающим кодом.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_estimate_item_dimensions() RETURNS TRIGGER AS $$
BEGIN
  NEW.project_id := (SELECT e.project_id FROM estimates e WHERE e.id = NEW.estimate_id);
  NEW.cost_category_id := COALESCE(
    (SELECT ct.category_id FROM cost_types ct WHERE ct.id = NEW.cost_type_id),
    (SELECT e.cost_category_id FROM estimates e WHERE e.id = NEW.estimate_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_items_sync_dim') THEN
    CREATE TRIGGER trg_estimate_items_sync_dim
      BEFORE INSERT OR UPDATE ON estimate_items
      FOR EACH ROW EXECUTE FUNCTION sync_estimate_item_dimensions();
  END IF;
END $$;

-- ============================================================
-- 9. Принудительный пересчёт итогов всех смет (работы + материалы)
-- ============================================================
UPDATE estimates e SET total_amount =
    (SELECT COALESCE(SUM(total), 0) FROM estimate_items     WHERE estimate_id = e.id)
  + (SELECT COALESCE(SUM(total), 0) FROM estimate_materials WHERE estimate_id = e.id);
