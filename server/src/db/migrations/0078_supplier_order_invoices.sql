-- 0078: счета заказа поставщику (платёжные документы присуждённого заказа).
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ ПОЛЯ В supplier_order_offers.
-- Это разные сущности с разным жизненным циклом:
--   offers   — коммерческие предложения КОНКУРИРУЮЩИХ поставщиков, живут на стадии сбора (forming/
--              sourcing), ровно один файл на строку (на этом держится проверка победителя в
--              applyWinnerProposal: response_status='received' AND file_key IS NOT NULL);
--   invoices — платёжные документы УЖЕ ВЫБРАННОГО поставщика, появляются после присуждения, и их
--              несколько: правка состава или смена поставщика требуют нового счёта.
-- Попытка расширить offers сломала бы три вещи разом: признак «у победителя есть документ»
-- перестал бы быть однозначным, has_file/file_name в карточке стали бы многозначными, а удаление
-- предложения (чистит ОДИН объект в S3) — неполным.
--
-- ПОЧЕМУ ДАННЫЕ ИЗ offers НЕ ПЕРЕНОСЯТСЯ. Копия ссылалась бы на тот же самый ключ в S3, и удаление
-- предложения снесло бы файл из-под строки счёта. Перенос с копированием объекта — лишняя рискованная
-- операция ради нескольких исторических записей: старые счета остаются доступны там, где и были.
--
-- ПОЧЕМУ invoice_revision, А НЕ ФЛАГ «нужен новый счёт». Флаг пришлось бы гасить в трёх местах
-- (загрузка счёта, отмена, смена поставщика), и любой пропуск оставил бы вечное предупреждение.
-- Ревизия же выводится сравнением: у заказа она растёт при каждом изменении, требующем нового
-- документа, а «счёт актуален» = существует непогашенный счёт с ревизией не ниже текущей.
-- Старт с 1 означает, что ранее присуждённые заказы не окажутся задним числом «без счёта».
--
-- ПОЧЕМУ СЧЕТА НЕ УДАЛЯЮТСЯ, А ЗАМЕЩАЮТСЯ (superseded_at). Счёт — документ поставщика: он был
-- выставлен и мог быть отправлен в оплату. История замещений показывает, почему счёт потерял силу.
--
-- Аддитивная и идемпотентная (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- Ревизия заказа: номер, под который должен быть выставлен действующий счёт.
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS invoice_revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS supplier_order_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  -- Ревизия заказа на момент выставления счёта (см. обоснование выше).
  invoice_revision  INTEGER NOT NULL DEFAULT 1,
  -- Реквизиты. Заполняются вручную либо распознаванием — источник в source.
  invoice_no        TEXT,
  invoice_date      DATE,
  amount            NUMERIC(15,2),
  vat_amount        NUMERIC(15,2),
  vat_rate          NUMERIC(5,2),
  supplier_name     TEXT,
  supplier_inn      TEXT,
  source            TEXT NOT NULL DEFAULT 'manual',
  -- Файл. Имена полей те же, что у supplier_order_offers и material_request_files:
  -- guardedStreamUpload отдаёт ровно этот набор.
  file_key          TEXT NOT NULL,
  file_name         TEXT,
  mime_type         TEXT,
  checksum          TEXT,
  file_size         BIGINT,
  -- Замещение вместо удаления.
  superseded_at     TIMESTAMPTZ,
  superseded_reason TEXT,
  note              TEXT,
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_invoices_source_check') THEN
    ALTER TABLE supplier_order_invoices ADD CONSTRAINT supplier_order_invoices_source_check
      CHECK (source IN ('manual','llm','llm_edited'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_invoices_superseded_check') THEN
    ALTER TABLE supplier_order_invoices ADD CONSTRAINT supplier_order_invoices_superseded_check
      CHECK (superseded_reason IS NULL
             OR superseded_reason IN ('composition_changed','award_revoked','replaced'));
  END IF;
  -- Причина замещения без самого факта замещения (и наоборот) — рассогласование: гасим на уровне БД.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_invoices_superseded_pair_check') THEN
    ALTER TABLE supplier_order_invoices ADD CONSTRAINT supplier_order_invoices_superseded_pair_check
      CHECK ((superseded_at IS NULL) = (superseded_reason IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_invoices_amount_check') THEN
    ALTER TABLE supplier_order_invoices ADD CONSTRAINT supplier_order_invoices_amount_check
      CHECK ((amount IS NULL OR amount >= 0) AND (vat_amount IS NULL OR vat_amount >= 0));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_soinv_order ON supplier_order_invoices (order_id, created_at DESC);
-- Действующие счета: по ним считается признак «заказ ждёт новый счёт».
CREATE INDEX IF NOT EXISTS ix_soinv_active ON supplier_order_invoices (order_id, invoice_revision)
  WHERE superseded_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_supplier_order_invoices_updated_at') THEN
    CREATE TRIGGER trg_supplier_order_invoices_updated_at
      BEFORE UPDATE ON supplier_order_invoices
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
