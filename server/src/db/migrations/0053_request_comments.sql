-- 0053: чат-комментарии к заявке (общение подрядчик ↔ снабжение) + статус прочтения.
--   recipient: NULL=«Всем» | 'contractor'=Подрядчику | 'supply'=Снабжению.
--   Непрочитанность = комментарий created_at > last_read_at, не свой, адресован мне/всем.
-- Аддитивная и идемпотентная миграция.

CREATE TABLE IF NOT EXISTS material_request_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  text        TEXT NOT NULL,
  recipient   TEXT,                          -- NULL='Всем' | 'contractor' | 'supply'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ                     -- NULL до правки; заполнение = признак «ред.»
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_request_comments_recipient_check') THEN
    ALTER TABLE material_request_comments ADD CONSTRAINT material_request_comments_recipient_check
      CHECK (recipient IS NULL OR recipient IN ('contractor', 'supply'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mrc_request ON material_request_comments(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS material_request_comment_read_status (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id   UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mrc_read ON material_request_comment_read_status(user_id, request_id);
