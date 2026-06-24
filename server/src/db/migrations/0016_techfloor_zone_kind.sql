-- 0016: добавляем kind 'techfloor' (техэтаж) в допустимые значения зоны объекта.
-- CHECK нельзя «расширить» на месте — пересоздаём. DROP+ADD не меняет строки;
-- ADD CONSTRAINT берёт короткий lock и валидирует существующие строки (таблица мала — приемлемо).
-- Имя constraint создано инлайн в 0015 → 'project_zones_kind_check' (сверено по pg_constraint).
-- Идемпотентно: DROP IF EXISTS + повторный ADD безопасны при повторном прогоне.
ALTER TABLE project_zones DROP CONSTRAINT IF EXISTS project_zones_kind_check;
ALTER TABLE project_zones
  ADD CONSTRAINT project_zones_kind_check
  CHECK (kind IN ('building', 'parking', 'stylobate', 'section', 'roof', 'other', 'techfloor'));
