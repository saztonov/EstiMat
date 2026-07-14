-- 0059: упрощение оформления заказа поставщику СУ-10 в одно пошаговое окно.
--   • supplier_orders: НДС ручного заказа (vat0/vat22) и тип поставки (advance/postpay) — заполняются
--     из документа победителя при оформлении;
--   • supplier_order_offers: список ВСЕХ поставщиков-предложений со статусом ответа (pending/received/
--     no_response), необязательной суммой и вложением (КП/счёт) прямо на строке предложения;
--   • supplier_order_price_lines: цены победителя ПО АГРЕГАТУ материала (agg_key), а не по исходным
--     позициям заявок — как в Excel КП и тендерном payload (нет дублей одного материала из разных заявок).
--   Победитель определяется существующим supplier_orders.awarded_quote_id (без дублирующего is_winner).
--   Набор sourcing_status НЕ расширяется: forming = «оформляется/черновик», sourcing/manual = «сбор
--   предложений», awarded = «оформлен» — инвариант И1 (размещённого количества) не затрагивается.
-- Аддитивная, идемпотентная (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- ============================================================
-- 1. supplier_orders: НДС ручного заказа и тип поставки (nullable — заполняются при оформлении победителя)
-- ============================================================
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS vat_rate     TEXT;  -- vat0 | vat22 (ручной заказ)
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS payment_type TEXT;  -- advance | postpay

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_vat_rate_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_vat_rate_check
      CHECK (vat_rate IS NULL OR vat_rate IN ('vat0','vat22'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_payment_type_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_payment_type_check
      CHECK (payment_type IS NULL OR payment_type IN ('advance','postpay'));
  END IF;
END $$;

-- ============================================================
-- 2. supplier_order_offers: статус ответа, тип документа, вложение, необязательная сумма
-- ============================================================
ALTER TABLE supplier_order_offers ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE supplier_order_offers ADD COLUMN IF NOT EXISTS document_type   TEXT;             -- quote | invoice
-- Вложение предложения на самой строке (1:1 с поставщиком). Имена как в material_request_files.
ALTER TABLE supplier_order_offers ADD COLUMN IF NOT EXISTS file_key   TEXT;
ALTER TABLE supplier_order_offers ADD COLUMN IF NOT EXISTS file_name  TEXT;
ALTER TABLE supplier_order_offers ADD COLUMN IF NOT EXISTS mime_type  TEXT;
ALTER TABLE supplier_order_offers ADD COLUMN IF NOT EXISTS checksum   TEXT;
ALTER TABLE supplier_order_offers ADD COLUMN IF NOT EXISTS file_size  BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_offers_response_status_check') THEN
    ALTER TABLE supplier_order_offers ADD CONSTRAINT supplier_order_offers_response_status_check
      CHECK (response_status IN ('pending','received','no_response'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_offers_document_type_check') THEN
    ALTER TABLE supplier_order_offers ADD CONSTRAINT supplier_order_offers_document_type_check
      CHECK (document_type IS NULL OR document_type IN ('quote','invoice'));
  END IF;
END $$;

-- Сумма становится необязательной: поставщика можно добавить только с файлом (без цены).
-- Инлайновый CHECK 0054 имеет детерминированное имя supplier_order_offers_amount_check — снимаем по имени.
ALTER TABLE supplier_order_offers ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE supplier_order_offers DROP CONSTRAINT IF EXISTS supplier_order_offers_amount_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_offers_amount_pos_check') THEN
    ALTER TABLE supplier_order_offers ADD CONSTRAINT supplier_order_offers_amount_pos_check
      CHECK (amount IS NULL OR amount > 0);
  END IF;
END $$;

-- ============================================================
-- 3. supplier_order_price_lines — цены победителя по агрегату материала (agg_key)
--    Финансовые строки соответствуют агрегированному материалу (как в Excel КП/тендере): один материал
--    из нескольких заявок = одна строка, без расхождений округления. Пишутся при оформлении (finalize).
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_order_price_lines (
  order_id        UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  agg_key         TEXT NOT NULL,
  unit_price      NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),  -- ≥0: допускаем бесплатную строку/образец
  warranty_months INT CHECK (warranty_months >= 0),
  PRIMARY KEY (order_id, agg_key)
);
