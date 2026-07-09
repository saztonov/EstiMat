-- 0038_recalc_stmt_and_catalog_idx.sql
-- Быстродействие: пересчёт итога сметы row-level → statement-level (полный SUM один раз на
-- затронутую смету вместо N раз при массовых операциях); точные индексы под зеркалирование
-- материалов в каталог; сужение триггера синхронизации измерений.
-- Идемпотентно: CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.

-- ============================================================
-- 1. Индексы под find-or-create в mirrorMaterialsToCatalog (lib/catalog.ts).
--    Выражения ДОЛЖНЫ совпадать с WHERE в коде: lower(btrim(...)); is_active — в предикате
--    partial-индекса, а не первым столбцом ключа.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_material_groups_parent_name
  ON material_groups (parent_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_material_catalog_group_name_unit
  ON material_catalog (group_id, lower(btrim(name)), lower(btrim(unit)))
  WHERE is_active;

-- ============================================================
-- 2. Пересчёт итога сметы: statement-level с transition tables.
--    Полный SUM(items)+SUM(materials) один раз на затронутую смету. Полный (а не delta) —
--    для смет 300–1500 строк это миллисекунды под row-lock estimates, и он самокорректируется
--    (delta накапливал бы дрейф при пропущенном пути записи / переносе строки между сметами).
-- ============================================================

-- Общий пересчёт по списку смет.
CREATE OR REPLACE FUNCTION recalc_estimate_totals(p_ids uuid[]) RETURNS void AS $$
  UPDATE estimates e SET
    total_amount =
      COALESCE((SELECT SUM(total) FROM estimate_items     WHERE estimate_id = e.id), 0)
    + COALESCE((SELECT SUM(total) FROM estimate_materials WHERE estimate_id = e.id), 0),
    updated_at = now()
  WHERE e.id = ANY(p_ids);
$$ LANGUAGE sql;

-- Триггерные функции (общие для estimate_items и estimate_materials — обе несут estimate_id).
-- Имена transition-таблиц new_rows/old_rows фиксированы и совпадают с REFERENCING в триггерах.
CREATE OR REPLACE FUNCTION recalc_estimate_on_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalc_estimate_totals(ARRAY(SELECT DISTINCT estimate_id FROM new_rows));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recalc_estimate_on_delete() RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalc_estimate_totals(ARRAY(SELECT DISTINCT estimate_id FROM old_rows));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- UPDATE: учитываем обе стороны — перенос строки между сметами меняет обе.
CREATE OR REPLACE FUNCTION recalc_estimate_on_update() RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalc_estimate_totals(ARRAY(
    SELECT DISTINCT estimate_id FROM (
      SELECT estimate_id FROM old_rows
      UNION
      SELECT estimate_id FROM new_rows
    ) s
  ));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Снять старые row-level триггеры (0001 на items, 0005 на materials) и повесить statement-level.
DROP TRIGGER IF EXISTS trg_estimate_recalc            ON estimate_items;
DROP TRIGGER IF EXISTS trg_estimate_materials_recalc  ON estimate_materials;

DROP TRIGGER IF EXISTS trg_items_recalc_ins ON estimate_items;
DROP TRIGGER IF EXISTS trg_items_recalc_del ON estimate_items;
DROP TRIGGER IF EXISTS trg_items_recalc_upd ON estimate_items;
CREATE TRIGGER trg_items_recalc_ins AFTER INSERT ON estimate_items
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recalc_estimate_on_insert();
CREATE TRIGGER trg_items_recalc_del AFTER DELETE ON estimate_items
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recalc_estimate_on_delete();
CREATE TRIGGER trg_items_recalc_upd AFTER UPDATE ON estimate_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recalc_estimate_on_update();

DROP TRIGGER IF EXISTS trg_materials_recalc_ins ON estimate_materials;
DROP TRIGGER IF EXISTS trg_materials_recalc_del ON estimate_materials;
DROP TRIGGER IF EXISTS trg_materials_recalc_upd ON estimate_materials;
CREATE TRIGGER trg_materials_recalc_ins AFTER INSERT ON estimate_materials
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recalc_estimate_on_insert();
CREATE TRIGGER trg_materials_recalc_del AFTER DELETE ON estimate_materials
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recalc_estimate_on_delete();
CREATE TRIGGER trg_materials_recalc_upd AFTER UPDATE ON estimate_materials
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recalc_estimate_on_update();

-- ============================================================
-- 3. Сужение синхронизации измерений строки: на UPDATE пересчитывать project_id/категорию
--    только если изменились источники (estimate_id / cost_type_id). Иначе два подзапроса на
--    каждую строку выполнялись впустую при любой правке (кол-во, цена, объём, sort_order…).
-- ============================================================
CREATE OR REPLACE FUNCTION sync_estimate_item_dimensions() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.estimate_id  IS NOT DISTINCT FROM OLD.estimate_id
     AND NEW.cost_type_id IS NOT DISTINCT FROM OLD.cost_type_id THEN
    RETURN NEW;
  END IF;
  NEW.project_id := (SELECT e.project_id FROM estimates e WHERE e.id = NEW.estimate_id);
  NEW.cost_category_id := COALESCE(
    (SELECT ct.category_id FROM cost_types ct WHERE ct.id = NEW.cost_type_id),
    (SELECT e.cost_category_id FROM estimates e WHERE e.id = NEW.estimate_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. Контрольный пересчёт всех смет новым механизмом (гарантия консистентности после смены).
-- ============================================================
SELECT recalc_estimate_totals(ARRAY(SELECT id FROM estimates));
