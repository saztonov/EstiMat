-- 0044: справочник поставщиков — снимок из BillHub (база rp, таблица suppliers).
--   Наполняется seed-миграцией 0050. id сохраняем из BillHub (стабильная идентичность).
--   security_status: approved | rejected | null (last_security_status BillHub); rejected скрываем в API.
-- Аддитивная и идемпотентная миграция.

CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  inn             TEXT,
  security_status TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Поиск по названию (pg_trgm уже используется в проекте) и по ИНН.
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_inn ON suppliers(inn);
