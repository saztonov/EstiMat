-- 0024_row_version.sql
-- Optimistic Concurrency Control для строк сметы.
-- Монотонный version-счётчик на строках работ и материалов: при одновременной
-- правке одной строки двумя инженерами «опоздавший» PUT с устаревшим
-- expectedVersion отклоняется (409), а не затирает чужие изменения молча.
-- updated_at для этого ненадёжен (now() фиксируется на начало транзакции,
-- pg/JS Date теряют микросекунды) — используем отдельный INTEGER.
-- Идемпотентно: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, pg_trigger-guard.

ALTER TABLE estimate_items     ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE estimate_materials ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Инкремент версии на любом UPDATE строки (независимо от update_updated_at).
CREATE OR REPLACE FUNCTION bump_version() RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_items_version') THEN
    CREATE TRIGGER trg_estimate_items_version
      BEFORE UPDATE ON estimate_items
      FOR EACH ROW EXECUTE FUNCTION bump_version();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_materials_version') THEN
    CREATE TRIGGER trg_estimate_materials_version
      BEFORE UPDATE ON estimate_materials
      FOR EACH ROW EXECUTE FUNCTION bump_version();
  END IF;
END $$;
