-- 0040: заказы поставщику и оплаты (прямые маршруты РП / собственная закупка).
--   Прямой заказ (kind='direct') привязан к одной заявке 1:1 — по нему ведутся оплаты.
--   Автопересчёт статуса заявки: есть заказ → supplier_selected; оплаты покрыли сумму → paid.
--   Контур снабжения СУ-10 (раунды/предложения/выбор, kind='sourcing' + order_items) —
--   отдельной миграцией в следующей фазе.
-- Аддитивная и идемпотентная миграция.

-- ============================================================
-- 1. Заказ поставщику
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID REFERENCES material_requests(id) ON DELETE CASCADE,  -- прямой заказ: 1:1 с заявкой
  kind          TEXT NOT NULL DEFAULT 'direct',
  supplier_name TEXT NOT NULL,
  supplier_inn  TEXT,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  rp_number     TEXT,           -- номер распределительного письма (маршрут РП)
  rp_date       DATE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_kind_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_kind_check
      CHECK (kind IN ('direct', 'sourcing'));
  END IF;
END $$;

-- Прямой заказ — не более одного на заявку (для маршрутов РП/подрядчик).
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_orders_direct_request
  ON supplier_orders(request_id) WHERE kind = 'direct' AND request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_orders_request ON supplier_orders(request_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_supplier_orders_updated_at') THEN
    CREATE TRIGGER trg_supplier_orders_updated_at
      BEFORE UPDATE ON supplier_orders
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. Оплаты по заказу (частичные оплаты допускаются)
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_order_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  paid_at     DATE,
  doc_number  TEXT,
  comment     TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sop_order ON supplier_order_payments(order_id);
