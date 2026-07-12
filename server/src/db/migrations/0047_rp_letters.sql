-- 0047: РП-письмо PayHub (артефакт синхронизации) + фиксация исходящего набора вложений.
--   Заявка получает статус rp_sent только после создания письма в PayHub; sync_status —
--   отдельная ось прогресса синхронизации (не влияет на бизнес-статус заявки).
--   rp_letter_attachments фиксирует ИМЕННО те файлы, что ушли в письмо (платёжки не входят).
-- Аддитивная и идемпотентная миграция.

CREATE TABLE IF NOT EXISTS rp_letters (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  external_ref       TEXT NOT NULL,                    -- estimat:rp:<request_id>
  payhub_letter_id   TEXT,                             -- id письма в PayHub (set-once)
  payhub_reg_number  TEXT,                             -- официальный рег.номер (генерит PayHub)
  payhub_url         TEXT,                             -- share-ссылка письма
  payhub_status      TEXT,                             -- статус письма в PayHub (опц.)
  sent_at            TIMESTAMPTZ,
  sync_status        TEXT NOT NULL DEFAULT 'pending',  -- pending|synced|waiting_config|failed|annulled
  attempts           INT NOT NULL DEFAULT 0,
  last_error         TEXT,
  lease_token        TEXT,
  locked_until       TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rp_letters_sync_status_check') THEN
    ALTER TABLE rp_letters ADD CONSTRAINT rp_letters_sync_status_check
      CHECK (sync_status IN ('pending', 'synced', 'waiting_config', 'failed', 'annulled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_rp_letters_external_ref ON rp_letters(external_ref);
-- Одно активное письмо на заявку (задел под аннулирование/перевыпуск в будущем).
CREATE UNIQUE INDEX IF NOT EXISTS ux_rp_letters_active_request
  ON rp_letters(request_id) WHERE sync_status <> 'annulled';
CREATE UNIQUE INDEX IF NOT EXISTS ux_rp_letters_payhub_id
  ON rp_letters(payhub_letter_id) WHERE payhub_letter_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rp_letters_updated_at') THEN
    CREATE TRIGGER trg_rp_letters_updated_at
      BEFORE UPDATE ON rp_letters
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Исходящий набор вложений письма (фиксируется в момент отправки; платёжные документы НЕ входят).
CREATE TABLE IF NOT EXISTS rp_letter_attachments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rp_letter_id         UUID NOT NULL REFERENCES rp_letters(id) ON DELETE CASCADE,
  file_id              UUID NOT NULL REFERENCES material_request_files(id) ON DELETE CASCADE,
  payhub_attachment_id TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rp_letter_attachments ON rp_letter_attachments(rp_letter_id, file_id);

ALTER TABLE material_request_files ADD COLUMN IF NOT EXISTS payhub_attachment_id TEXT;
