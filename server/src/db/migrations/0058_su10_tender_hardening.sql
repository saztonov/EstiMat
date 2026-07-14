-- 0058: харднинг тендерной интеграции закупочных лотов (надёжная отмена, revision-guard, no_award).
--   Аддитивно к 0054 (контур лотов) и 0038 (integration_outbox). Реализует:
--     • desired_tender_state — ось намерения «активен/отменён» для saga надёжной отмены тендера
--       (команда tender.cancel доставляется через outbox с ретраями; поллер подтверждает cancelled);
--     • tender_remote_revision — монотонная версия состояния тендера с портала (guard от применения
--       устаревшего снимка при параллельном опросе/ручном обновлении);
--     • no_award — терминальная стадия лота: тендер завершён без победителя, остаток освобождён;
--     • partial unique index — не более одной АКТИВНОЙ команды tender.create/tender.cancel на лот.
-- Идемпотентная миграция, совместимая с deploy-estimat --migrate (один батч, чистый SQL).

-- 1. Ось надёжной отмены + версия состояния тендера.
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS desired_tender_state   TEXT NOT NULL DEFAULT 'active';
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_remote_revision INT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_desired_tender_state_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_desired_tender_state_check
      CHECK (desired_tender_state IN ('active','cancelled'));
  END IF;
END $$;

-- 2. Терминальный статус no_award в перечне стадий лота (пересоздаём CHECK как расширенный супернабор).
ALTER TABLE supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_sourcing_status_check;
ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_sourcing_status_check
  CHECK (sourcing_status IS NULL OR sourcing_status IN
         ('forming','sourcing','awarded','cancel_pending','cancelled','no_award'));

-- 3. Одна активная команда tender.create/tender.cancel на лот (идемпотентность постановки в outbox).
CREATE UNIQUE INDEX IF NOT EXISTS ux_outbox_active_tender_cmd
  ON integration_outbox(aggregate_id, command_type)
  WHERE command_type IN ('tender.create','tender.cancel')
    AND status IN ('queued','retry_wait','waiting_config');
