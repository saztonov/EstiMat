-- 0076_request_quantity_edit_history.sql
-- История правок объёмов заявки: одна таблица вместо трёх мест хранения.
--
-- ЧТО БЫЛО НЕ ТАК. Данные о правках лежали в трёх местах сразу: денормализованные колонки позиции
-- (quantity_original / quantity_changed_at / quantity_changed_by), массив items внутри записи
-- журнала и — по замыслу — отдельная таблица. Сверх того значение «было» читалось ПОСЛЕ обновления
-- из quantity_original, которое фиксирует ПЕРВЫЙ объём, а не предыдущий: вторая правка 8 → 6
-- записывалась как «10 → 6». Три источника расходились, и ни один не был полным.
--
-- МОДЕЛЬ. Строка истории принадлежит ОДНОЙ пользовательской операции, а операция — записи журнала.
-- Ссылка на audit_log и есть идентификатор операции: она даёт группировку нескольких позиций одной
-- правки, естественную идемпотентность переноса и связь с существующей лентой истории заявки.
--
-- Идемпотентно, один батч (deploy-estimat --migrate).

CREATE TABLE IF NOT EXISTS material_request_quantity_edits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Операция. CASCADE здесь уместен: без своей записи журнала подробности не значат ничего.
  audit_id        UUID NOT NULL REFERENCES audit_log(id) ON DELETE CASCADE,
  -- Позиция — БЕЗ каскада. Сегодня подробности переживают доработку заявки (позиции пересоздаются),
  -- и каскадное удаление стало бы регрессией: история правки исчезала бы вместе со строкой.
  request_item_id UUID REFERENCES material_request_items(id) ON DELETE SET NULL,
  request_id      UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  -- Снимок названия: позиция может исчезнуть, а история обязана остаться читаемой.
  material_name   TEXT NOT NULL,
  quantity_from   NUMERIC NOT NULL,
  quantity_to     NUMERIC NOT NULL,
  -- Запись «объём не изменился» смысла не имеет и замусорила бы ленту. Сравнение numeric, а не
  -- текстовое: '10.0' и '10' здесь равны, как и должны быть.
  CONSTRAINT mrqe_actually_changed CHECK (quantity_from <> quantity_to),
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одна позиция — одна строка в рамках операции. Позволяет переносу быть идемпотентным и не даёт
-- задвоить запись при повторе запроса.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mrqe_operation_item
  ON material_request_quantity_edits(audit_id, request_item_id);
CREATE INDEX IF NOT EXISTS ix_mrqe_request ON material_request_quantity_edits(request_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_mrqe_item    ON material_request_quantity_edits(request_item_id, changed_at DESC);

-- ============================================================
-- Перенос существующих данных — РЕКОНСТРУКЦИЯ, а не копирование
-- ============================================================
-- В журнале уже лежат искажённые «было»: со второй правки там стоит исходный объём вместо
-- предыдущего. Прямой перенос закрепил бы ошибку навсегда, поэтому quantity_from берётся как
-- «стало» ПРЕДЫДУЩЕЙ записи по той же позиции (в порядке времени журнала), и только у первой
-- записи — из самого журнала, где оно верное.
--
-- Идемпотентность — по операции: повторный прогон не найдёт ни одной необработанной записи.
WITH src AS (
  SELECT a.id AS audit_id, a.entity_id AS request_id, a.user_id, a.created_at,
         it.value ->> 'itemId' AS item_id,
         it.value ->> 'name'   AS material_name,
         (it.value ->> 'from')::numeric AS from_logged,
         (it.value ->> 'to')::numeric   AS to_logged
    FROM audit_log a
    CROSS JOIN LATERAL jsonb_array_elements(a.changes -> 'items') AS it(value)
   WHERE a.entity_type = 'material_request'
     AND a.action = 'items_quantity_updated'
     AND jsonb_typeof(a.changes -> 'items') = 'array'
     AND it.value ->> 'itemId' IS NOT NULL
     AND it.value ->> 'to' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM material_request_quantity_edits e WHERE e.audit_id = a.id)
), reconstructed AS (
  SELECT s.*,
         -- Предыдущее «стало» по той же позиции; у первой правки его нет — берём журнальное «было».
         COALESCE(
           lag(s.to_logged) OVER (PARTITION BY s.item_id ORDER BY s.created_at, s.audit_id),
           s.from_logged
         ) AS from_fixed
    FROM src s
)
INSERT INTO material_request_quantity_edits
  (audit_id, request_item_id, request_id, material_name, quantity_from, quantity_to, changed_by, changed_at)
SELECT r.audit_id,
       -- Позиция могла исчезнуть при доработке — тогда остаётся только снимок имени.
       (SELECT mri.id FROM material_request_items mri WHERE mri.id = r.item_id::uuid),
       r.request_id,
       COALESCE(r.material_name, '—'),
       r.from_fixed,
       r.to_logged,
       r.user_id,
       r.created_at
  FROM reconstructed r
 WHERE r.from_fixed IS NOT NULL
   AND r.from_fixed <> r.to_logged
   -- Заявка могла быть удалена: FK на material_requests не даст вставить висячую ссылку.
   AND EXISTS (SELECT 1 FROM material_requests mr WHERE mr.id = r.request_id);

-- ============================================================
-- Удаление денормализованных колонок (решение заказчика, окно выкатки принято)
-- ============================================================
-- Снимаются ПОСЛЕ переноса, в той же миграции. Во время выкатки старый экземпляр API отвечает
-- ошибкой на карточку заявки — принято осознанно, выкатка в нерабочее время.
ALTER TABLE material_request_items DROP COLUMN IF EXISTS quantity_original;
ALTER TABLE material_request_items DROP COLUMN IF EXISTS quantity_changed_at;
ALTER TABLE material_request_items DROP COLUMN IF EXISTS quantity_changed_by;
