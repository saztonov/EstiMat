-- 0072_procurement_substitutions.sql
-- Замещение ответственного за закупки на период болезни/отпуска. Пока период активен,
-- эффективным ответственным во всех сводах и заявках считается замещающий; исходное назначение
-- (0071) сохраняется и возвращается в силу автоматически по окончании периода — без фонового
-- пересчёта, потому что подмена вычисляется при чтении.
--
-- Почему пересечения периодов НЕ закрыты EXCLUDE-констрейнтом: он требует btree_gist, а
-- CREATE EXTENSION приложению недоступен (роль не суперпользователь — см. 0013_ai_chat.sql).
-- Проверка живёт в приложении и сериализуется блокировкой строк users обоих участников:
-- SELECT ... FOR UPDATE по самой таблице замещений ничего не заблокировал бы, когда строк ещё
-- нет, и два параллельных INSERT создали бы пересечение.
--
-- Досрочное завершение — отдельные ended_at/ended_by, а НЕ правка ends_on: дата окончания
-- включительна, поэтому «завершить сегодня» через ends_on оставило бы заместителя действующим
-- до полуночи. Плановые даты при этом сохраняются для истории.
--
-- Идемпотентно, один батч (deploy-estimat --migrate): CREATE TABLE/INDEX IF NOT EXISTS,
-- CREATE OR REPLACE VIEW, констрейнты под pg_constraint-гвардом.

CREATE TABLE IF NOT EXISTS procurement_substitutions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- кого замещают
  deputy_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- кто замещает
  starts_on         DATE NOT NULL,
  ends_on           DATE NOT NULL,          -- включительно
  ended_at          TIMESTAMPTZ,            -- досрочное завершение (NULL — идёт по плану)
  ended_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  reason            TEXT,                   -- свободный текст: отпуск, больничный, командировка
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_substitutions_period_check') THEN
    ALTER TABLE procurement_substitutions ADD CONSTRAINT procurement_substitutions_period_check
      CHECK (ends_on >= starts_on);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_substitutions_self_check') THEN
    ALTER TABLE procurement_substitutions ADD CONSTRAINT procurement_substitutions_self_check
      CHECK (deputy_user_id <> principal_user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_psub_principal ON procurement_substitutions(principal_user_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS ix_psub_deputy    ON procurement_substitutions(deputy_user_id);

-- ============================================================
-- Вью: эффективный ответственный по виду затрат (справочные уровни)
-- ============================================================
-- Покрывает уровни ВИД → КАТЕГОРИЯ и применяет активное замещение. Материальный уровень
-- (procurement_material_responsible) сюда не входит намеренно: он зависит от объекта и
-- подрядчика строки, поэтому подмешивается в запросах свода. Полный приоритет
-- «материал → вид → категория → замещение» собирает один серверный резолвер
-- (server/src/lib/procurement/responsibles.ts) — правило нужно в пяти местах, и вью
-- удерживает от расхождения хотя бы справочную его часть.
--
-- Дата активности пришпилена к Europe/Moscow, а не CURRENT_DATE: иначе результат зависел бы от
-- таймзоны сервера БД. Первое вью в проекте; при изменении НАБОРА колонок понадобится
-- DROP VIEW IF EXISTS ... CASCADE — CREATE OR REPLACE менять состав колонок не позволяет.
CREATE OR REPLACE VIEW v_procurement_responsible_effective AS
SELECT ct.id          AS cost_type_id,
       ct.category_id AS category_id,
       COALESCE(ptr.user_id, pcr.user_id) AS assigned_user_id,
       CASE WHEN ptr.user_id IS NOT NULL THEN 'type'
            WHEN pcr.user_id IS NOT NULL THEN 'category' END AS assigned_source,
       COALESCE(sub.deputy_user_id, ptr.user_id, pcr.user_id) AS effective_user_id,
       sub.id AS substitution_id
  FROM cost_types ct
  LEFT JOIN procurement_cost_type_responsible ptr ON ptr.cost_type_id = ct.id
  LEFT JOIN procurement_category_responsible  pcr ON pcr.category_id  = ct.category_id
  LEFT JOIN procurement_substitutions sub
         ON sub.principal_user_id = COALESCE(ptr.user_id, pcr.user_id)
        AND sub.ended_at IS NULL
        AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN sub.starts_on AND sub.ends_on;
