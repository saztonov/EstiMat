-- 0025_material_qty_ratio.sql
-- Коэффициент расхода материала в строке сметы.
-- qty_ratio — собственный коэффициент материала: если задан, его количество держится
-- равным qty_ratio × объём работы (estimate_items.quantity) и пересчитывается на сервере
-- при изменении объёма работы. NULL — ручное количество (как у всех текущих строк).
-- total остаётся генерируемой колонкой (quantity * unit_price), поэтому пересчёт затрагивает
-- только quantity; total и total_amount сметы следуют через триггеры.
-- Идемпотентно: ADD COLUMN IF NOT EXISTS.

ALTER TABLE estimate_materials ADD COLUMN IF NOT EXISTS qty_ratio NUMERIC;
