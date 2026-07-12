-- 0046: реквизиты формы «Оформить РП» у прямого заказа (supplier_orders, kind='direct').
--   amount уже хранит сумму счёта. supplier_id ссылается на снимок справочника поставщиков.
-- Аддитивная и идемпотентная миграция.

ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS supplier_id         UUID REFERENCES suppliers(id);
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS delivery_days       INT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS delivery_days_type  TEXT NOT NULL DEFAULT 'working';
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS shipping_conditions TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS rp_comment          TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_delivery_days_type_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_delivery_days_type_check
      CHECK (delivery_days_type IN ('working', 'calendar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_delivery_days_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_delivery_days_check
      CHECK (delivery_days IS NULL OR delivery_days > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier ON supplier_orders(supplier_id);
