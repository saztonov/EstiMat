-- 0029: физическое (hard) удаление пользователей.
-- Три FK на users(id) были без ON DELETE (NO ACTION) и блокировали DELETE FROM users,
-- если пользователь — автор/утверждающий сметы или фигурирует в аудите. Переводим их
-- на ON DELETE SET NULL (в духе остальных authorship-полей из 0014): данные остаются,
-- ссылка на удалённого пользователя обнуляется. Идемпотентно, чистый SQL.

-- estimates.created_by: снять NOT NULL (иначе SET NULL невозможен) и пересоздать FK
ALTER TABLE estimates ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_created_by_fkey;
ALTER TABLE estimates ADD CONSTRAINT estimates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- estimates.approved_by (уже nullable)
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_approved_by_fkey;
ALTER TABLE estimates ADD CONSTRAINT estimates_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

-- audit_log.user_id (уже nullable)
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
