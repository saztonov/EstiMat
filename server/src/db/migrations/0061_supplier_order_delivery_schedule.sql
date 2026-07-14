-- 0061: собственный редактируемый график поставки заказа поставщику/тендера.
--   График заявки (material_request_items) не меняется — снимок дат заявки переносится в позиции
--   заказа (0060). Здесь снабжение при формировании заказа/тендера может задать СВОЙ график и
--   править его до фиксации состава. Ключ — agg_key (агрегат материала: как в запросе КП, тендере и
--   оформлении победителя; в agg_key закодирована и единица измерения), НЕ request_item_id.
--   По умолчанию график предзаполняется снимком дат заявки; запрос КП и спецификация тендера
--   используют этот график с fallback на снимок дат заявки, если он не задан.
-- Идемпотентная миграция, совместимая с deploy-estimat --migrate (один батч, чистый SQL).

CREATE TABLE IF NOT EXISTS supplier_order_delivery_schedule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  agg_key       TEXT NOT NULL,
  delivery_date DATE NOT NULL,
  quantity      NUMERIC NOT NULL CHECK (quantity > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один агрегат материала — одна строка на дату (уникальность даты в рамках заказа+материала).
CREATE UNIQUE INDEX IF NOT EXISTS ux_sods_order_agg_date
  ON supplier_order_delivery_schedule (order_id, agg_key, delivery_date);
CREATE INDEX IF NOT EXISTS idx_sods_order ON supplier_order_delivery_schedule (order_id);
