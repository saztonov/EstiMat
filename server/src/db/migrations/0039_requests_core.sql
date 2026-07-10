-- 0039: единый жизненный цикл заявок ВНУТРИ EstiMat (без BillHub).
--   * request_type += own_supply (собственная закупка подрядчиком).
--   * material_requests.status — единый КАНОНИЧЕСКИЙ статус нового процесса
--     (in_work | revision | supplier_selected | paid | delivered). Старые значения
--     (confirmed/created/sent/rp_created/paid) переносятся; CHECK пересобирается.
--   * Снимки объекта/подрядчика (финансовая история переживает удаление сметы/оргов).
--   * Идемпотентность создания (create_request_id + payload_hash) и row_version.
--   * FK-фиксы: estimate_id CASCADE→SET NULL (+DROP NOT NULL), contractor_id CASCADE→RESTRICT.
--   * material_request_revisions — доработки; material_request_files — документы заявки.
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- ============================================================
-- 1. Вид заявки: добавить own_supply (пересобрать именованный CHECK)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_request_type_check') THEN
    ALTER TABLE material_requests DROP CONSTRAINT material_requests_request_type_check;
  END IF;
  ALTER TABLE material_requests
    ADD CONSTRAINT material_requests_request_type_check
    CHECK (request_type IN ('own_supplier', 'su10', 'own_supply', 'legacy'));
END $$;

-- ============================================================
-- 2. Единый статус: backfill значений ДО смены CHECK, затем новый CHECK + DEFAULT
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_status_check') THEN
    ALTER TABLE material_requests DROP CONSTRAINT material_requests_status_check;
  END IF;
END $$;

-- Перенос старых значений в канонический набор.
UPDATE material_requests SET status = 'in_work'
  WHERE status IN ('confirmed', 'created', 'sent');
UPDATE material_requests SET status = 'supplier_selected'
  WHERE status = 'rp_created';
-- status='paid' остаётся 'paid'; на всякий случай любое неизвестное значение → in_work.
UPDATE material_requests SET status = 'in_work'
  WHERE status NOT IN ('in_work', 'revision', 'supplier_selected', 'paid', 'delivered');

ALTER TABLE material_requests ALTER COLUMN status SET DEFAULT 'in_work';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_status_check') THEN
    ALTER TABLE material_requests
      ADD CONSTRAINT material_requests_status_check
      CHECK (status IN ('in_work', 'revision', 'supplier_selected', 'paid', 'delivered'));
  END IF;
END $$;

-- ============================================================
-- 3. Идемпотентность, версия, снимки, аудит смены статуса
-- ============================================================
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS create_request_id TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS payload_hash      TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS row_version       INT NOT NULL DEFAULT 0;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS project_name      TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS estimate_label    TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS contractor_name   TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS contractor_inn    TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- request_no мог отсутствовать до 0037 — гарантируем наличие (для номера заявки в разделе).
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS request_no INT;

-- Идемпотентность пользовательского POST: один клиентский ключ на организацию-заявителя.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mr_create_request_id
  ON material_requests(contractor_id, create_request_id)
  WHERE create_request_id IS NOT NULL;

-- Снимок имён для существующих строк (финансовая история не зависит от join'ов).
UPDATE material_requests mr
   SET project_name    = COALESCE(mr.project_name, p.name),
       estimate_label  = COALESCE(mr.estimate_label, e.work_type),
       contractor_name = COALESCE(mr.contractor_name, org.name),
       contractor_inn  = COALESCE(mr.contractor_inn, org.inn)
  FROM material_requests m2
  LEFT JOIN projects p       ON p.id  = m2.project_id
  LEFT JOIN estimates e      ON e.id  = m2.estimate_id
  LEFT JOIN organizations org ON org.id = m2.contractor_id
 WHERE mr.id = m2.id
   AND (mr.project_name IS NULL OR mr.contractor_name IS NULL);

-- ============================================================
-- 4. FK-фиксы: заявка переживает удаление сметы; подрядчика удалить нельзя, пока есть заявки
-- ============================================================
ALTER TABLE material_requests ALTER COLUMN estimate_id DROP NOT NULL;

-- estimate_id: любой существующий FK (кроме целевого) → пересоздать с ON DELETE SET NULL.
DO $$
DECLARE cname text;
BEGIN
  FOR cname IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'material_requests'::regclass AND con.contype = 'f'
       AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                 WHERE attrelid = 'material_requests'::regclass
                                   AND attname = 'estimate_id' AND NOT attisdropped)]
       AND con.conname <> 'mr_estimate_fk'
  LOOP
    EXECUTE format('ALTER TABLE material_requests DROP CONSTRAINT %I', cname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mr_estimate_fk') THEN
    ALTER TABLE material_requests ADD CONSTRAINT mr_estimate_fk
      FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE SET NULL;
  END IF;
END $$;

-- contractor_id: пересоздать с ON DELETE RESTRICT.
DO $$
DECLARE cname text;
BEGIN
  FOR cname IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'material_requests'::regclass AND con.contype = 'f'
       AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                 WHERE attrelid = 'material_requests'::regclass
                                   AND attname = 'contractor_id' AND NOT attisdropped)]
       AND con.conname <> 'mr_contractor_fk'
  LOOP
    EXECUTE format('ALTER TABLE material_requests DROP CONSTRAINT %I', cname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mr_contractor_fk') THEN
    ALTER TABLE material_requests ADD CONSTRAINT mr_contractor_fk
      FOREIGN KEY (contractor_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mr_status       ON material_requests(status);
CREATE INDEX IF NOT EXISTS idx_mr_type_status  ON material_requests(request_type, status);
CREATE INDEX IF NOT EXISTS idx_mr_contractor   ON material_requests(contractor_id);
CREATE INDEX IF NOT EXISTS idx_mr_project      ON material_requests(project_id);

-- ============================================================
-- 5. Доработки заявки (причина/ответ/авторы/pre-статус)
-- ============================================================
CREATE TABLE IF NOT EXISTS material_request_revisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,                 -- комментарий снабжения «что доработать»
  prev_status   TEXT,                          -- статус заявки до отправки на доработку
  response      TEXT,                           -- комментарий подрядчика при завершении
  requested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mrr_request ON material_request_revisions(request_id, requested_at);

-- ============================================================
-- 6. Документы заявки (приватный S3-prefix, тот же механизм EstiMat, без bh_*)
-- ============================================================
CREATE TABLE IF NOT EXISTS material_request_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL DEFAULT 'other',
  file_name   TEXT NOT NULL,
  file_key    TEXT NOT NULL,                   -- приватный ключ S3: material-requests/<id>/<uuid>_<name>
  file_size   BIGINT,
  mime_type   TEXT,
  checksum    TEXT,
  superseded  BOOLEAN NOT NULL DEFAULT false,  -- файл замещён новой версией (вместо физ. удаления в пакете)
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_request_files_doc_type_check') THEN
    ALTER TABLE material_request_files
      ADD CONSTRAINT material_request_files_doc_type_check
      CHECK (doc_type IN ('invoice','quote','spec','contract','payment','delivery','other'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_mrf_request ON material_request_files(request_id);
