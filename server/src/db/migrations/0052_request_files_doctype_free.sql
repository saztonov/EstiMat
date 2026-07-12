-- 0052: тип документа файла заявки — свободный текст.
--   Типы документов теперь из справочника billhub (снимок в shared-константах),
--   валидация на уровне Zod; жёсткий CHECK снимаем, чтобы набор типов можно было расширять.
-- Идемпотентная миграция.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_request_files_doc_type_check') THEN
    ALTER TABLE material_request_files DROP CONSTRAINT material_request_files_doc_type_check;
  END IF;
END $$;
