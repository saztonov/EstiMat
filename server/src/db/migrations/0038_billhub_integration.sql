-- 0038: интеграция EstiMat ↔ BillHub (заявки на материалы → заявки на оплату по РП).
--   * material_requests.request_type — маршрут заявки: own_supplier (свой поставщик/РП) | su10
--     (закупка через СУ-10) | legacy (исторические строки до типизации). Статус материалки
--     отвязан от BillHub: новые заявки получают нейтральный 'created'; жизненный цикл оплаты
--     живёт в payment_requests и приходит из BillHub.
--   * payment_requests / payment_request_files / payment_request_history — локальная read-модель
--     заявки на оплату + снимок позиций/реквизитов (переживает удаление сметы/оргов).
--   * integration_outbox — надёжная исходящая очередь команд в BillHub (SKIP LOCKED + backoff).
--   * integration_inbox — идемпотентный приём событий BillHub по event_id.
--   * notifications — уведомления подрядчику о смене статуса/доработке/оплате.
--   * billhub_ref_cache — кэш справочников BillHub (поставщики/условия/типы документов).
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- ============================================================
-- 1. Тип заявки на материалы + нейтральный статус
-- ============================================================
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS request_type TEXT;

-- Исторические заявки (до типизации) помечаем legacy.
UPDATE material_requests SET request_type = 'legacy' WHERE request_type IS NULL;
ALTER TABLE material_requests ALTER COLUMN request_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_request_type_check') THEN
    ALTER TABLE material_requests
      ADD CONSTRAINT material_requests_request_type_check
      CHECK (request_type IN ('own_supplier', 'su10', 'legacy'));
  END IF;
END $$;

-- Статус материалки: добавляем нейтральный 'created' (для новых заявок); sent/rp_created/paid —
-- legacy-значения, для новых заявок не используются. Пересобираем именованный CHECK.
ALTER TABLE material_requests ALTER COLUMN status SET DEFAULT 'created';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_status_check') THEN
    ALTER TABLE material_requests DROP CONSTRAINT material_requests_status_check;
  END IF;
  ALTER TABLE material_requests
    ADD CONSTRAINT material_requests_status_check
    CHECK (status IN ('created', 'sent', 'rp_created', 'paid'));
END $$;

-- ============================================================
-- 2. Заявка на оплату (локальная read-модель + команда)
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- источник: жёсткое 1:1 с заявкой на материалы (snapshot переживает удаление сметы → SET NULL)
  material_request_id         UUID UNIQUE REFERENCES material_requests(id) ON DELETE SET NULL,
  items_snapshot              JSONB NOT NULL DEFAULT '[]',   -- снимок позиций материалки на момент создания
  -- идемпотентность
  create_request_id           TEXT NOT NULL UNIQUE,          -- клиентский ключ (защита от повторного POST)
  external_ref                TEXT NOT NULL UNIQUE,          -- estimat:pr:<id> (идемпотентность в BillHub)
  -- контекст (заполняется сервером из материалки; снимок для финансовой истории)
  estimate_id                 UUID REFERENCES estimates(id) ON DELETE SET NULL,
  project_id                  UUID REFERENCES projects(id) ON DELETE SET NULL,
  contractor_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  contractor_name             TEXT,
  contractor_inn              TEXT,
  -- маппинг на BillHub (выведен сервером)
  bh_site_id                  TEXT,
  bh_site_name                TEXT,
  bh_counterparty_id          TEXT,
  bh_counterparty_name        TEXT,
  bh_counterparty_inn         TEXT,
  -- выбор подрядчика из справочников BillHub
  bh_supplier_id              TEXT,
  bh_supplier_name            TEXT,
  bh_supplier_inn             TEXT,
  bh_shipping_condition_id    TEXT,
  bh_shipping_condition_value TEXT,
  delivery_days               INT,
  delivery_days_type          TEXT NOT NULL DEFAULT 'working',
  invoice_amount              NUMERIC(15, 2),
  comment                     TEXT,
  -- жизненный цикл (три независимые оси)
  lifecycle_state             TEXT NOT NULL DEFAULT 'draft',  -- draft | submitted
  bh_request_id               TEXT,                           -- id заявки в BillHub (после submit)
  bh_request_number           TEXT,
  bh_request_url              TEXT,
  -- проекция из BillHub
  status_code                 TEXT,                           -- approv_shtab/approv_omts/approv_rp/approved/revision/rejected/withdrawn
  action_required             BOOLEAN NOT NULL DEFAULT false,
  revision_comment            TEXT,
  rp_number                   TEXT,
  rp_date                     DATE,
  paid_status                 TEXT,                           -- not_paid/partially_paid/paid
  total_paid                  NUMERIC(15, 2) NOT NULL DEFAULT 0,
  last_payment_date           DATE,
  last_bh_version             INT NOT NULL DEFAULT 0,         -- версия проекции (порядок событий)
  created_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_lifecycle_check') THEN
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_lifecycle_check
      CHECK (lifecycle_state IN ('draft', 'submitted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_delivery_type_check') THEN
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_delivery_type_check
      CHECK (delivery_days_type IN ('working', 'calendar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_amount_check') THEN
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_amount_check
      CHECK (invoice_amount IS NULL OR invoice_amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_delivery_days_check') THEN
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_delivery_days_check
      CHECK (delivery_days IS NULL OR delivery_days > 0);
  END IF;
END $$;

-- Уникальность id заявки BillHub (для непустых значений).
CREATE UNIQUE INDEX IF NOT EXISTS ux_pr_bh_request_id
  ON payment_requests(bh_request_id) WHERE bh_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pr_contractor ON payment_requests(contractor_id, status_code);
CREATE INDEX IF NOT EXISTS idx_pr_material_request ON payment_requests(material_request_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pr_updated_at') THEN
    CREATE TRIGGER trg_pr_updated_at
      BEFORE UPDATE ON payment_requests
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Файлы (счета) заявки на оплату — приватный S3-prefix; передаются в BillHub при синхронизации.
CREATE TABLE IF NOT EXISTS payment_request_files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id  UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  bh_document_type_id TEXT,
  file_name           TEXT NOT NULL,
  file_key            TEXT NOT NULL,
  file_size           BIGINT,
  mime_type           TEXT,
  checksum            TEXT,
  bh_file_id          TEXT,                            -- id файла в BillHub (после confirm)
  sync_status         TEXT NOT NULL DEFAULT 'pending', -- pending | synced | failed
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prf_request ON payment_request_files(payment_request_id);

-- Журнал применённых событий/действий (для карточки и аудита проекции).
CREATE TABLE IF NOT EXISTS payment_request_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL,
  aggregate_version  INT,
  detail             JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prh_request ON payment_request_history(payment_request_id, created_at);

-- ============================================================
-- 3. Исходящая очередь команд в BillHub (transactional outbox)
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type  TEXT NOT NULL,               -- 'payment_request'
  aggregate_id    UUID NOT NULL,
  command_type    TEXT NOT NULL,               -- 'payment_request.submit'
  external_ref    TEXT,                        -- estimat:pr:<id>
  payload         JSONB NOT NULL,              -- неизменяемая команда
  payload_hash    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued', -- queued|retry_wait|waiting_config|delivered|dead_letter
  attempts        INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token     UUID,
  locked_until    TIMESTAMPTZ,
  error_code      TEXT,
  last_error      TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_outbox_status_check') THEN
    ALTER TABLE integration_outbox ADD CONSTRAINT integration_outbox_status_check
      CHECK (status IN ('queued', 'retry_wait', 'waiting_config', 'delivered', 'dead_letter'));
  END IF;
END $$;

-- Индекс для claim воркером: незавершённые команды по времени следующей попытки.
CREATE INDEX IF NOT EXISTS idx_outbox_due ON integration_outbox(next_attempt_at)
  WHERE status IN ('queued', 'retry_wait', 'waiting_config');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_outbox_updated_at') THEN
    CREATE TRIGGER trg_outbox_updated_at
      BEFORE UPDATE ON integration_outbox
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 4. Входящая идемпотентность событий BillHub (inbox)
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_inbox (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  external_ref      TEXT,
  bh_request_id     TEXT,
  aggregate_version INT,
  payload_hash      TEXT NOT NULL,
  result            TEXT,                       -- applied | ignored_stale | conflict
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbox_external_ref ON integration_inbox(external_ref);

-- ============================================================
-- 5. Уведомления подрядчику
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  org_id             UUID REFERENCES organizations(id) ON DELETE CASCADE,
  type               TEXT NOT NULL,
  title              TEXT NOT NULL,
  body               TEXT,
  payment_request_id UUID REFERENCES payment_requests(id) ON DELETE CASCADE,
  event_id           TEXT,
  is_read            BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- ============================================================
-- 6. Кэш справочников BillHub
-- ============================================================
CREATE TABLE IF NOT EXISTS billhub_ref_cache (
  ref_type       TEXT PRIMARY KEY,             -- 'suppliers' | 'shipping' | 'document_types'
  payload        JSONB NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
