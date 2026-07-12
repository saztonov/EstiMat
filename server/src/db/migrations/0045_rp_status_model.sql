-- 0045: РП-модель статусов заявок типа own_supplier («Оплата по РП»).
--   Новые коды: rp_forming (Оформление РП), rp_sent (РП отправлено), rp_paid (РП оплачено),
--   cancelled (Отменена). Применяются только к own_supplier; su10/own_supply не меняются.
--   CHECK расширяем ПЕРМИССИВНО (старые + новые коды вместе) — для безопасного single-deploy:
--   в момент наката старый API ещё может писать supplier_selected/paid, поэтому строгий парный
--   CHECK «тип↔статус» НЕ вводим; целостность пары держим в коде роутов.
-- Аддитивная и идемпотентная миграция.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_status_check') THEN
    ALTER TABLE material_requests DROP CONSTRAINT material_requests_status_check;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_status_check') THEN
    ALTER TABLE material_requests
      ADD CONSTRAINT material_requests_status_check
      CHECK (status IN (
        'in_work', 'revision', 'supplier_selected', 'paid', 'delivered',
        'rp_forming', 'rp_sent', 'rp_paid', 'cancelled'
      ));
  END IF;
END $$;

-- Бэкфилл существующих заявок own_supplier на РП-модель (объём мал, CHECK уже допускает оба набора).
UPDATE material_requests SET status = 'rp_forming'
  WHERE request_type = 'own_supplier' AND status = 'supplier_selected';
UPDATE material_requests SET status = 'rp_paid'
  WHERE request_type = 'own_supplier' AND status IN ('paid', 'delivered');

-- Индекс для вкладки «Реестр РП» и списков по статусу own_supplier.
CREATE INDEX IF NOT EXISTS idx_mr_rp_registry
  ON material_requests(status) WHERE request_type = 'own_supplier';
