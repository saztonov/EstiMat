-- 0069_material_item_responsibles.sql
-- Несколько ответственных на строку материала заявки (many-to-many поверх ответственных по
-- категории вида работ). Заменяет скалярную модель одного ответственного (0068): у одной
-- позиции свода «Материалы» может быть назначено несколько ответственных, любого можно снять.
-- Пусто — override не задан: показываются все ответственные по категории (прежнее поведение).
--
-- Идемпотентно, один батч (deploy-estimat --migrate): CREATE TABLE/INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, создание триггера через pg_trigger-гвард. Скалярные колонки 0068
-- НЕ удаляем — снимет отдельная миграция после завершения окна отката.
-- user_id ON DELETE CASCADE: входит в PK, обнулить нельзя; при hard-delete пользователя (0029)
-- назначение исчезает — как в procurement_category_responsibles (0056).

CREATE TABLE IF NOT EXISTS material_request_item_responsibles (
  request_item_id UUID NOT NULL REFERENCES material_request_items(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id)                  ON DELETE CASCADE,
  assigned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_item_id, user_id)   -- индекс по ведущему request_item_id — из PK
);

CREATE INDEX IF NOT EXISTS ix_mrir_user ON material_request_item_responsibles(user_id);

-- Бэкофилл из скалярной модели 0068 (по каждой назначенной строке; ON CONFLICT — безопасно к повтору).
INSERT INTO material_request_item_responsibles (request_item_id, user_id, assigned_by, assigned_at)
SELECT id, responsible_user_id, responsible_assigned_by, COALESCE(responsible_assigned_at, now())
  FROM material_request_items
 WHERE responsible_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Страховка окна деплоя: миграция накатывается раньше подъёма нового API. Пока работает старый
-- API (пишет только скалярный responsible_user_id), триггер отражает его правки в новую таблицу,
-- чтобы назначения этого окна не потерялись. В окне модель фактически одиночная (≤1 на строку),
-- поэтому логика простая: снять прежнего скалярного, добавить нового. Новый API скаляр не трогает
-- → после переключения триггер бездействует. Снимается отдельной миграцией.
CREATE OR REPLACE FUNCTION sync_scalar_responsible() RETURNS trigger AS $$
BEGIN
  IF OLD.responsible_user_id IS NOT NULL
     AND OLD.responsible_user_id IS DISTINCT FROM NEW.responsible_user_id THEN
    DELETE FROM material_request_item_responsibles
     WHERE request_item_id = NEW.id AND user_id = OLD.responsible_user_id;
  END IF;
  IF NEW.responsible_user_id IS NOT NULL THEN
    INSERT INTO material_request_item_responsibles (request_item_id, user_id, assigned_by, assigned_at)
    VALUES (NEW.id, NEW.responsible_user_id, NEW.responsible_assigned_by,
            COALESCE(NEW.responsible_assigned_at, now()))
    ON CONFLICT (request_item_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_scalar_responsible') THEN
    CREATE TRIGGER trg_sync_scalar_responsible
      AFTER UPDATE OF responsible_user_id ON material_request_items
      FOR EACH ROW EXECUTE FUNCTION sync_scalar_responsible();
  END IF;
END $$;
