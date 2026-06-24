-- Организация у проекта больше не указывается: удаляем колонку.
-- Удаление колонки автоматически снимает FK на organizations и индекс idx_projects_org_id.
ALTER TABLE projects DROP COLUMN IF EXISTS org_id;
