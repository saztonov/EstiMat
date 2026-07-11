-- Контроль изменений строк, попавших в ВОР.
-- Быстрый статус — построчный SHA-256 содержимого на момент выгрузки (estimate_vor_items.content_hash).
-- Точный diff «было → стало» — по gzip-manifest рядом с XLSX в S3 (метаданные в estimate_vors).
-- content_schema_version — версия формулы хэша + схемы снимка (0 = легаси ВОР до этой фичи).
-- Идемпотентно: ADD COLUMN IF NOT EXISTS, guard'ы через pg_constraint.

-- estimate_vors: версия формулы/схемы снимка и метаданные manifest-снимка в S3.
ALTER TABLE estimate_vors
  ADD COLUMN IF NOT EXISTS content_schema_version SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snapshot_key      TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_checksum BYTEA,
  ADD COLUMN IF NOT EXISTS snapshot_size     BIGINT;

-- estimate_vor_items: построчный хэш содержимого работы на момент выгрузки (sha256 = 32 байта).
ALTER TABLE estimate_vor_items
  ADD COLUMN IF NOT EXISTS content_hash BYTEA;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_vor_items_content_hash_len') THEN
    ALTER TABLE estimate_vor_items
      ADD CONSTRAINT estimate_vor_items_content_hash_len
      CHECK (content_hash IS NULL OR octet_length(content_hash) = 32);
  END IF;
END $$;

-- Снять ON DELETE CASCADE с item_id: удалённая работа остаётся историческим UUID (статус deleted
-- в ВОР), а не исчезает из выгрузки. vor_id CASCADE, PK (vor_id,item_id) и индекс по item_id — сохраняются.
DO $$ DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'estimate_vor_items'::regclass AND contype = 'f'
     AND confrelid = 'estimate_items'::regclass;
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE estimate_vor_items DROP CONSTRAINT %I', c); END IF;
END $$;
