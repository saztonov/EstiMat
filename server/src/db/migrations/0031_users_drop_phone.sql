-- Удаление неиспользуемого телефона пользователя
ALTER TABLE users DROP COLUMN IF EXISTS phone;
