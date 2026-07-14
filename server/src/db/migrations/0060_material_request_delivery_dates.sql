-- 0060: график поставки материалов заявки «Закупка через СУ-10».
--   Один материал заявки может требоваться к нескольким датам поставки: храним по строке на дату
--   в material_request_items с колонкой delivery_date. Остаток/«Заказано» уже считается как
--   SUM(quantity) по (cost_type_id, agg_key) — строки-по-датам подсчёты не ломают.
--   При формировании закупочного лота дата поставки переносится снимком в supplier_order_items.
--   Аддитивно к 0028 (material_request_items) и 0054 (supplier_order_items).
-- Идемпотентная миграция, совместимая с deploy-estimat --migrate (один батч, чистый SQL).

-- 1. Дата поставки строки заявки (NULL — материал без графика: прочие типы заявок).
ALTER TABLE material_request_items ADD COLUMN IF NOT EXISTS delivery_date DATE;

-- 2. Снимок даты поставки в позиции закупочного лота (переносится из строки заявки).
ALTER TABLE supplier_order_items ADD COLUMN IF NOT EXISTS delivery_date DATE;

-- 3. Индексы под свод/сортировку по датам поставки.
CREATE INDEX IF NOT EXISTS ix_mri_request_delivery ON material_request_items (request_id, delivery_date);
CREATE INDEX IF NOT EXISTS ix_soi_order_delivery   ON supplier_order_items   (order_id, delivery_date);
