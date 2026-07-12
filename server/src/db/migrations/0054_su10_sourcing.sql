-- 0054: контур снабжения СУ-10 (закупочные лоты).
--   Достраивает supplier_orders.kind='sourcing' (зарезервировано в 0040): один лот сводит
--   материалы из нескольких su10-заявок (связь заявка↔лот многие-ко-многим по количеству —
--   через supplier_order_items на уровне исходных строк). Стадии лота:
--   forming (редактируется, резервирует остаток) → sourcing (заморожен, идёт сбор КП/тендер)
--   → awarded (поставщик зафиксирован); ветви cancel_pending / cancelled.
--   Канал закупки (procurement_method): manual (запрос КП по почте) или tender (тендерный портал).
--   Поставщик фиксируется в конце (award): победитель тендера или лучшее КП (supplier_order_offers).
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- ============================================================
-- 1. Расширение supplier_orders под kind='sourcing'
-- ============================================================
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS project_id            UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS project_name          TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS order_no              INT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS title                 TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS sourcing_status       TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS procurement_method    TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS row_version           INT NOT NULL DEFAULT 0;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS client_request_id     UUID;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_external_ref   TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_portal_id      TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_url            TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_status         TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_sync_status    TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_results        JSONB;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_deadline_at    TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_attempts       INT NOT NULL DEFAULT 0;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_last_error     TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_next_poll_at   TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS tender_last_polled_at TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS awarded_at            TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS awarded_by            UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS award_source          TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS awarded_quote_id      UUID;

-- Sourcing-лот создаётся без поставщика/суммы (заполняются на award) — ослабляем NOT NULL.
-- Существующий CHECK (amount > 0) не трогаем: NULL проходит CHECK штатно.
ALTER TABLE supplier_orders ALTER COLUMN supplier_name DROP NOT NULL;
ALTER TABLE supplier_orders ALTER COLUMN amount        DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_sourcing_status_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_sourcing_status_check
      CHECK (sourcing_status IS NULL OR sourcing_status IN ('forming','sourcing','awarded','cancel_pending','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_procurement_method_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_procurement_method_check
      CHECK (procurement_method IS NULL OR procurement_method IN ('manual','tender'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_award_source_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_award_source_check
      CHECK (award_source IS NULL OR award_source IN ('tender','manual'));
  END IF;
  -- Прямой заказ (kind='direct') сохраняет прежний инвариант: поставщик и сумма обязательны.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_direct_fields_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_direct_fields_check
      CHECK (kind <> 'direct' OR (supplier_name IS NOT NULL AND amount IS NOT NULL));
  END IF;
  -- Sourcing-лот: привязан к объекту с номером и стадией, не привязан к одной заявке.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_sourcing_fields_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_sourcing_fields_check
      CHECK (kind <> 'sourcing' OR (project_id IS NOT NULL AND order_no IS NOT NULL
             AND sourcing_status IS NOT NULL AND request_id IS NULL));
  END IF;
  -- Присуждённый лот обязан иметь поставщика, сумму и источник award.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_awarded_fields_check') THEN
    ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_awarded_fields_check
      CHECK (sourcing_status IS DISTINCT FROM 'awarded'
             OR (supplier_name IS NOT NULL AND amount IS NOT NULL AND award_source IS NOT NULL AND awarded_at IS NOT NULL));
  END IF;
END $$;

-- Номер лота уникален в рамках объекта; идемпотентность создания по (создатель, клиентский ключ).
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_orders_project_no
  ON supplier_orders(project_id, order_no) WHERE kind = 'sourcing';
CREATE INDEX IF NOT EXISTS idx_supplier_orders_project_sourcing
  ON supplier_orders(project_id) WHERE kind = 'sourcing';
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_orders_client_req
  ON supplier_orders(created_by, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_orders_tender_ref
  ON supplier_orders(tender_external_ref) WHERE tender_external_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_orders_tender_portal
  ON supplier_orders(tender_portal_id) WHERE tender_portal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_orders_tender_poll
  ON supplier_orders(tender_next_poll_at) WHERE kind = 'sourcing' AND tender_status IS NOT NULL;

-- ============================================================
-- 2. Позиции лота — junction заявка↔лот по исходным строкам (многие-ко-многим по количеству)
--    Связь заявка↔лот = DISTINCT (order_id, request_id). Учёт размещённого = SUM(quantity)
--    по активным лотам (sourcing_status <> 'cancelled') на request_item_id.
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES supplier_orders(id)      ON DELETE CASCADE,
  request_id         UUID REFERENCES material_requests(id)             ON DELETE SET NULL,
  request_item_id    UUID REFERENCES material_request_items(id)        ON DELETE SET NULL,
  cost_type_id       UUID REFERENCES cost_types(id) ON DELETE SET NULL,
  material_id        UUID,
  material_name      TEXT NOT NULL,          -- снимок (переживает удаление)
  unit               TEXT NOT NULL,
  agg_key            TEXT NOT NULL,
  quantity           NUMERIC NOT NULL CHECK (quantity > 0),
  contractor_id      UUID,
  contractor_name    TEXT,                   -- снимок подрядчика
  request_no         INT,
  cost_type_name     TEXT,
  cost_category_name TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_soi_order_request_item ON supplier_order_items(order_id, request_item_id);
CREATE INDEX IF NOT EXISTS idx_soi_order        ON supplier_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_soi_request      ON supplier_order_items(request_id);
CREATE INDEX IF NOT EXISTS idx_soi_request_item ON supplier_order_items(request_item_id);

-- ============================================================
-- 3. Коммерческие предложения по лоту (manual-канал; выбор лучшего КП)
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_order_offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  supplier_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  supplier_inn  TEXT,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency      TEXT NOT NULL DEFAULT 'RUB',
  terms         TEXT,
  note          TEXT,
  file_id       UUID,
  submitted_at  DATE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_soo_order ON supplier_order_offers(order_id);

-- Присуждение по manual-каналу ссылается на выбранное КП.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_awarded_quote_fk') THEN
    ALTER TABLE supplier_orders
      ADD CONSTRAINT supplier_orders_awarded_quote_fk
      FOREIGN KEY (awarded_quote_id) REFERENCES supplier_order_offers(id) ON DELETE SET NULL;
  END IF;
END $$;
