-- 0075_procurement_substitution_single.sql
-- Детерминизм замещений: ровно одно активное замещение на сотрудника — как в данных, так и при чтении.
--
-- ЧТО БЫЛО НЕ ТАК (0072). Вью v_procurement_responsible_effective джойнила
-- procurement_substitutions напрямую, без ограничения кратности. Два активных замещения одного
-- принципала давали ДВЕ строки на cost_type_id, из-за чего в своде материалов дублировались
-- позиции заявок: SUM(requested)/SUM(placed) удваивались, а независимые MIN() при схлопывании
-- возвращали идентификатор одного человека и фамилию другого. Проверено воспроизведением.
--
-- ЧТО ДЕЛАЕМ:
--   1. Разбираем уже накопившиеся пересечения (закрываем лишние через ended_at, с записью в журнал).
--   2. Вводим ОДИН источник истины — v_procurement_active_substitution. Все потребители (вью
--      справочных уровней, резолвер, свод, дерево справочника) читают только его: правило выбора
--      победителя задано один раз, а не повторено четырьмя LATERAL.
--   3. Ставим триггер-страховку против новых пересечений.
--
-- ПОЧЕМУ ТРИГГЕР, А НЕ EXCLUDE. EXCLUDE (principal_user_id WITH =, daterange WITH &&) требует
-- btree_gist из-за скалярного равенства, а CREATE EXTENSION приложению недоступен (роль не
-- суперпользователь, см. 0013_ai_chat.sql). GiST умеет диапазоны сам, но не смешанный ключ.
--
-- ПОЧЕМУ ВНУТРИ ТРИГГЕРА БЛОКИРОВКА. Обычный SELECT EXISTS не видит незакоммиченных строк
-- параллельной транзакции: два одновременных INSERT прошли бы оба. Сериализуем по принципалу
-- через transaction-level advisory lock — он не требует существующих строк, в отличие от
-- SELECT ... FOR UPDATE по самой таблице замещений.
--
-- Идемпотентно, один батч (deploy-estimat --migrate): CREATE OR REPLACE VIEW/FUNCTION,
-- pg_trigger-гвард, разбор пересечений самоподавляется (после первого прогона их не остаётся).

-- ============================================================
-- 1. Разбор существующих пересечений
-- ============================================================
-- Победитель — позднейший по starts_on (то же правило, что и при чтении ниже; тай-брейк по id).
-- Проигравшие закрываются ended_at = now(): плановые даты сохраняются, история не теряется.
WITH ranked AS (
  SELECT id, principal_user_id,
         row_number() OVER (PARTITION BY principal_user_id ORDER BY starts_on DESC, id DESC) AS rn
    FROM procurement_substitutions
   WHERE ended_at IS NULL
     AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN starts_on AND ends_on
), losers AS (
  SELECT id, principal_user_id FROM ranked WHERE rn > 1
), closed AS (
  UPDATE procurement_substitutions s
     SET ended_at = now()
    FROM losers l
   WHERE s.id = l.id
  RETURNING s.id, s.principal_user_id, s.deputy_user_id, s.starts_on, s.ends_on
)
INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes)
SELECT 'procurement_substitution', c.id, 'procurement.substitution.auto_closed', NULL,
       jsonb_build_object(
         'reason', 'overlap_cleanup_0075',
         'principal', c.principal_user_id, 'deputy', c.deputy_user_id,
         'starts_on', c.starts_on, 'ends_on', c.ends_on)
  FROM closed c;

-- ============================================================
-- 2. Единый источник активного замещения
-- ============================================================
-- Один принципал — не более одной строки. Правило победителя (позднейшее по starts_on) описано
-- ЗДЕСЬ и больше нигде: остальные запросы джойнят эту вью, а не таблицу.
-- Дата пришпилена к Europe/Moscow, а не CURRENT_DATE — иначе результат зависел бы от таймзоны
-- сервера БД.
CREATE OR REPLACE VIEW v_procurement_active_substitution AS
SELECT DISTINCT ON (s.principal_user_id)
       s.principal_user_id,
       s.deputy_user_id,
       s.id AS substitution_id,
       s.starts_on,
       s.ends_on
  FROM procurement_substitutions s
 WHERE s.ended_at IS NULL
   AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN s.starts_on AND s.ends_on
 ORDER BY s.principal_user_id, s.starts_on DESC, s.id DESC;

-- Вью справочных уровней теперь берёт замещение из единого источника: состав колонок прежний,
-- поэтому CREATE OR REPLACE достаточно.
CREATE OR REPLACE VIEW v_procurement_responsible_effective AS
SELECT ct.id          AS cost_type_id,
       ct.category_id AS category_id,
       COALESCE(ptr.user_id, pcr.user_id) AS assigned_user_id,
       CASE WHEN ptr.user_id IS NOT NULL THEN 'type'
            WHEN pcr.user_id IS NOT NULL THEN 'category' END AS assigned_source,
       COALESCE(sub.deputy_user_id, ptr.user_id, pcr.user_id) AS effective_user_id,
       sub.substitution_id
  FROM cost_types ct
  LEFT JOIN procurement_cost_type_responsible ptr ON ptr.cost_type_id = ct.id
  LEFT JOIN procurement_category_responsible  pcr ON pcr.category_id  = ct.category_id
  LEFT JOIN v_procurement_active_substitution sub
         ON sub.principal_user_id = COALESCE(ptr.user_id, pcr.user_id);

-- ============================================================
-- 3. Страховка от новых пересечений
-- ============================================================
-- Advisory lock по принципалу сериализует конкурентные вставки: без него два параллельных INSERT
-- не увидели бы строк друг друга и оба прошли бы проверку. Блокировка транзакционная — снимается
-- на COMMIT/ROLLBACK сама.
--
-- Ошибку помечаем ERRCODE 23P01 (exclusion_violation) и именем ограничения: приложение отличает
-- её от прочих конфликтов по err.constraint, а не по тексту.
CREATE OR REPLACE FUNCTION procurement_substitution_no_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    RETURN NEW;  -- завершённое замещение никого не блокирует
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('procurement_substitution:' || NEW.principal_user_id::text));

  IF EXISTS (
    SELECT 1 FROM procurement_substitutions s
     WHERE s.principal_user_id = NEW.principal_user_id
       AND s.id <> NEW.id
       AND s.ended_at IS NULL
       AND daterange(s.starts_on, s.ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')
  ) THEN
    RAISE EXCEPTION 'Замещение пересекается с уже назначенным на этот период'
      USING ERRCODE = '23P01', CONSTRAINT = 'procurement_substitutions_overlap';
  END IF;

  -- Цепочки A→B→C не поддерживаются: заместитель не может сам быть замещаемым в пересекающийся
  -- период и наоборот. Проверка симметрична — иначе порядок создания определял бы результат.
  IF EXISTS (
    SELECT 1 FROM procurement_substitutions s
     WHERE s.id <> NEW.id
       AND s.ended_at IS NULL
       AND daterange(s.starts_on, s.ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')
       AND (s.principal_user_id = NEW.deputy_user_id OR s.deputy_user_id = NEW.principal_user_id)
  ) THEN
    RAISE EXCEPTION 'Замещающий сам замещается в этот период — цепочка замещений не поддерживается'
      USING ERRCODE = '23P01', CONSTRAINT = 'procurement_substitutions_chain';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_procurement_substitution_no_overlap') THEN
    CREATE TRIGGER trg_procurement_substitution_no_overlap
      BEFORE INSERT OR UPDATE OF principal_user_id, deputy_user_id, starts_on, ends_on, ended_at
      ON procurement_substitutions
      FOR EACH ROW EXECUTE FUNCTION procurement_substitution_no_overlap();
  END IF;
END $$;

-- Выборка активных: условие «активно сегодня» через now() в индексе невыразимо (не IMMUTABLE),
-- поэтому предикат — по ended_at, а даты уходят в ключ.
CREATE INDEX IF NOT EXISTS ix_psub_active
  ON procurement_substitutions(principal_user_id, starts_on DESC, ends_on)
  WHERE ended_at IS NULL;
