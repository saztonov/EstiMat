-- 0071_procurement_responsible_scopes.sql
-- Ответственные за закупки: переход от «много ответственных на категорию» (0056) к модели
-- «ОДИН ответственный на область», где области образуют три уровня наследования:
--
--   материал (объект+подрядчик+вид затрат+материал) → вид затрат → категория затрат
--
-- Эффективный ответственный строки заявки = COALESCE(материал, вид, категория), затем поверх
-- накладывается активное замещение (0072). Категорийный уровень остаётся дефолтом «на всё»,
-- уровень вида задаёт исключения, уровень материала — точечные назначения из свода «Материалы».
--
-- Почему PRIMARY KEY по области, а не (область, пользователь): «один ответственный» становится
-- инвариантом БД, а не соглашением приложения. Материальный уровень использует
-- UNIQUE NULLS NOT DISTINCT (PG15+; проект на PG17) — иначе строки с NULL в project_id/
-- contractor_id/cost_type_id считались бы различными и правило «один ответственный» на них
-- не действовало бы.
--
-- Идемпотентно, один батч (deploy-estimat --migrate): CREATE TABLE/INDEX IF NOT EXISTS,
-- бэкофилл через ON CONFLICT DO NOTHING. Миграция FORWARD-ONLY: старая таблица
-- procurement_category_responsibles остаётся как архив для ручного восстановления, но НЕ
-- синхронизируется — откат приложения на старую версию вернёт устаревшие назначения.
-- user_id ON DELETE CASCADE: пользователей проект удаляет hard-delete'ом (0029), назначение
-- при этом исчезает — как в 0056/0069. assigned_by ON DELETE SET NULL: запись должна пережить
-- удаление назначившего.

-- ============================================================
-- 1. Уровень категории затрат: дефолт «на всё внутри категории»
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_category_responsible (
  category_id UUID PRIMARY KEY REFERENCES cost_categories(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL     REFERENCES users(id)          ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pcatr_user ON procurement_category_responsible(user_id);

-- ============================================================
-- 2. Уровень вида затрат: исключение из категорийного дефолта
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_cost_type_responsible (
  cost_type_id UUID PRIMARY KEY REFERENCES cost_types(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL    REFERENCES users(id)      ON DELETE CASCADE,
  assigned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pctr_user ON procurement_cost_type_responsible(user_id);

-- ============================================================
-- 3. Уровень материала: точечное назначение из свода «Материалы»
-- ============================================================
-- Ключ области намеренно совпадает с ключом схлопывания строки свода: один материал в рамках
-- одного объекта и подрядчика — одна строка и один ответственный. Назначение живёт ЗДЕСЬ, а не
-- на строках заявок, поэтому автоматически действует и на будущие заявки с тем же материалом
-- (в модели «override на каждой строке» новая заявка получала бы дефолт из справочника).
CREATE TABLE IF NOT EXISTS procurement_material_responsible (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id)      ON DELETE CASCADE,
  contractor_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  cost_type_id  UUID REFERENCES cost_types(id)    ON DELETE CASCADE,
  agg_key       TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_pmr_scope') THEN
    ALTER TABLE procurement_material_responsible
      ADD CONSTRAINT ux_pmr_scope
      UNIQUE NULLS NOT DISTINCT (project_id, contractor_id, cost_type_id, agg_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_pmr_user ON procurement_material_responsible(user_id);

-- ============================================================
-- 4. Бэкофилл категорий: схлопывание «многих» в одного
-- ============================================================
-- Правило победителя детерминированное: сначала активные пользователи, среди них — назначенный
-- раньше всех (де-факто основной владелец категории), тай-брейк по user_id для стабильности.
INSERT INTO procurement_category_responsible (category_id, user_id, assigned_by, assigned_at)
SELECT DISTINCT ON (p.category_id)
       p.category_id, p.user_id, p.assigned_by, p.created_at
  FROM procurement_category_responsibles p
  JOIN users u ON u.id = p.user_id
 ORDER BY p.category_id, u.is_active DESC, p.created_at, p.user_id
ON CONFLICT (category_id) DO NOTHING;

-- Фиксация потерь: схлопывание отбирает у части людей право формировать заказы, и это должно
-- быть видно в журнале, а не проявиться внезапно. Пишем по записи на каждую категорию, где
-- кого-то отбросили. user_id = NULL — событие системное (audit_log.user_id nullable).
INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes)
SELECT 'procurement_responsibles', t.category_id, 'procurement.responsibles.collapsed', NULL,
       jsonb_build_object('before', t.before, 'kept', t.kept, 'dropped', t.dropped)
  FROM (
    SELECT p.category_id,
           jsonb_agg(p.user_id ORDER BY p.user_id) AS before,
           to_jsonb(k.user_id)                     AS kept,
           jsonb_agg(p.user_id ORDER BY p.user_id) FILTER (WHERE p.user_id <> k.user_id) AS dropped
      FROM procurement_category_responsibles p
      JOIN procurement_category_responsible k ON k.category_id = p.category_id
     GROUP BY p.category_id, k.user_id
    HAVING count(*) > 1
  ) t
 WHERE NOT EXISTS (
   SELECT 1 FROM audit_log a
    WHERE a.entity_type = 'procurement_responsibles'
      AND a.entity_id = t.category_id
      AND a.action = 'procurement.responsibles.collapsed'
 );

-- ============================================================
-- 5. Бэкофилл материального уровня из построчных назначений (0069)
-- ============================================================
-- Переносим ТОЛЬКО реально существующие override'ы: область, где назначения не было, обязана
-- и дальше опираться на справочник. Иначе миграция насоздавала бы точечных назначений там, где
-- пользователь сознательно работает на категорийном дефолте, — необратимая потеря смысла.
-- Победитель в области — ПОСЛЕДНИЙ по assigned_at (свежее решение снабженца важнее давнего).
INSERT INTO procurement_material_responsible
       (project_id, contractor_id, cost_type_id, agg_key, user_id, assigned_by, assigned_at)
SELECT DISTINCT ON (mr.project_id, mr.contractor_id, mri.cost_type_id, mri.agg_key)
       mr.project_id, mr.contractor_id, mri.cost_type_id, mri.agg_key,
       r.user_id, r.assigned_by, r.assigned_at
  FROM material_request_item_responsibles r
  JOIN material_request_items mri ON mri.id = r.request_item_id
  JOIN material_requests mr       ON mr.id = mri.request_id
 WHERE mr.status <> 'cancelled'
 ORDER BY mr.project_id, mr.contractor_id, mri.cost_type_id, mri.agg_key,
          r.assigned_at DESC, r.user_id
ON CONFLICT ON CONSTRAINT ux_pmr_scope DO NOTHING;

-- ============================================================
-- 6. Пометка старых таблиц как архивных
-- ============================================================
COMMENT ON TABLE procurement_category_responsibles IS
  'DEPRECATED (0071): архив модели «много ответственных на категорию». Не читается и не пишется '
  'приложением; заменена procurement_category_responsible. Удалить отдельной миграцией после '
  'окна отката.';
COMMENT ON TABLE material_request_item_responsibles IS
  'DEPRECATED (0071): архив построчных назначений. Ответственный теперь хранится по области '
  '(procurement_material_responsible), что распространяет назначение и на будущие заявки. '
  'Удалить отдельной миграцией после окна отката.';
