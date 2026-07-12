-- 0049: идемпотентность оплат и задел под сторно.
--   client_payment_id — ключ идемпотентности регистрации оплаты (защита от двойного POST);
--   reversed          — append-only сторно (оплата не удаляется, а помечается сторнированной);
--   file_id           — платёжный документ, подтверждающий оплату.
-- Аддитивная и идемпотентная миграция.

ALTER TABLE supplier_order_payments ADD COLUMN IF NOT EXISTS client_payment_id TEXT;
ALTER TABLE supplier_order_payments ADD COLUMN IF NOT EXISTS reversed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE supplier_order_payments ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES material_request_files(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sop_client_payment_id
  ON supplier_order_payments(order_id, client_payment_id) WHERE client_payment_id IS NOT NULL;
