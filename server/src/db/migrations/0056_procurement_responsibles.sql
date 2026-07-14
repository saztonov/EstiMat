-- 0056_procurement_responsibles.sql
-- Справочник «Закупки»: закрепление категорий работ (cost_categories) за ответственными
-- пользователями (users). Много ответственных на категорию (many-to-many). Ответственные
-- за категорию + администраторы распределяют материалы этой категории в заказы поставщику.
--
-- Идемпотентно: CREATE TABLE / CREATE INDEX IF NOT EXISTS. Один батч — без psql-метакоманд.
-- assigned_by ON DELETE SET NULL: пользователей проект удаляет hard-delete'ом (0029), запись
-- назначения при этом должна пережить удаление назначившего.

CREATE TABLE IF NOT EXISTS procurement_category_responsibles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES cost_categories(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, user_id)   -- индекс по ведущему category_id обеспечивается этим UNIQUE
);

CREATE INDEX IF NOT EXISTS ix_pcr_user ON procurement_category_responsibles(user_id);
