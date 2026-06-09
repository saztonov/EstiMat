-- 0006: удаление наследия разделов после перехода на строко-центричную модель.
-- Применять ПОСЛЕ того, как сервер/клиент перестали ссылаться на section_id /
-- item_type / material_id (estimate_items) и estimates.contractor_id.
-- Идемпотентно: IF EXISTS.

-- estimate_items: section_id (FK на estimate_sections), item_type (+ CHECK уйдёт
-- автоматически), material_id (материалы теперь в estimate_materials).
ALTER TABLE estimate_items DROP COLUMN IF EXISTS section_id;
ALTER TABLE estimate_items DROP COLUMN IF EXISTS item_type;
ALTER TABLE estimate_items DROP COLUMN IF EXISTS material_id;

-- estimates.contractor_id — deprecated, подрядчик теперь в estimate_contractors.
ALTER TABLE estimates DROP COLUMN IF EXISTS contractor_id;

-- Таблица разделов больше не нужна (триггер/индексы уйдут вместе с ней).
DROP TABLE IF EXISTS estimate_sections;
