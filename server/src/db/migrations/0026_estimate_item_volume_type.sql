-- 0026_estimate_item_volume_type.sql
-- Тип объёма строки сметы: 'main' (осн) / 'additional' (доп).
-- Полноценная колонка-классификатор — фундамент для раздельных итогов/фильтрации/экспорта.
-- Существующие строки → 'main' через DEFAULT. Идемпотентно.

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS volume_type TEXT NOT NULL DEFAULT 'main';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_items_volume_type_check') THEN
    ALTER TABLE estimate_items
      ADD CONSTRAINT estimate_items_volume_type_check CHECK (volume_type IN ('main', 'additional'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_volume_type
  ON estimate_items (estimate_id, volume_type);

-- Переопределение bump_version: переключение volume_type (бейдж осн/доп) НЕ поднимает version.
-- Это частый тумблер с моментальной записью, и ложный рост version вызывал бы 409 у форм,
-- редактирующих другие поля той же строки. Toggle-роут ставит на свою транзакцию
-- SET LOCAL estimat.skip_version_bump = 'on'; вне такой транзакции current_setting вернёт
-- NULL (missing_ok) и version растёт как раньше — для всех прочих UPDATE поведение не меняется.
CREATE OR REPLACE FUNCTION bump_version() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('estimat.skip_version_bump', true) = 'on' THEN
    NEW.version = OLD.version;
    RETURN NEW;
  END IF;
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
