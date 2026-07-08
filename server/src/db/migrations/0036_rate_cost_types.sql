-- 0036_rate_cost_types.sql
-- Связь «наименование работы ↔ вид работ» из one-to-many в many-to-many.
-- Одна работа (rates) может принадлежать нескольким видам (cost_types) одновременно.
--
-- Модель: единственный источник истины — таблица-связка rate_cost_types.
-- Столбец rates.cost_type_id удаляется; «основной вид» (для строки сметы по умолчанию
-- и AI-путей) хранится флагом is_primary. Категорию строки сметы по-прежнему выводит
-- триггер sync_estimate_item_dimensions из estimate_items.cost_type_id, поэтому уже
-- сохранённые сметы не затрагиваются.
--
-- Плюс мягкое удаление (is_active) для видов и категорий — по аналогии с rates.is_active.
--
-- Идемпотентно: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP COLUMN IF EXISTS, backfill в DO-блоке под проверкой существования колонки,
-- ON CONFLICT DO NOTHING. Обёрнуто в транзакцию — мигратор сам её не открывает.

BEGIN;

-- Мягкое удаление для верхних уровней справочника (у rates.is_active уже есть).
ALTER TABLE cost_categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE cost_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Таблица-связка работа ↔ вид (many-to-many).
CREATE TABLE IF NOT EXISTS rate_cost_types (
  rate_id UUID NOT NULL REFERENCES rates(id) ON DELETE CASCADE,
  cost_type_id UUID NOT NULL REFERENCES cost_types(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_id, cost_type_id)
);

-- Обратный джойн «вид → его работы».
CREATE INDEX IF NOT EXISTS idx_rate_cost_types_cost_type_id ON rate_cost_types(cost_type_id);
-- Не более одного основного вида на работу (ровно один обеспечивает backend в транзакциях).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_cost_types_primary
  ON rate_cost_types(rate_id) WHERE is_primary;

-- Перенос текущих связей 1:1 (каждая работа → её единственный вид как основной).
-- Не сливает одноимённые работы из разных видов — переносит как есть.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rates' AND column_name = 'cost_type_id'
  ) THEN
    INSERT INTO rate_cost_types (rate_id, cost_type_id, is_primary)
    SELECT id, cost_type_id, true FROM rates
    ON CONFLICT (rate_id, cost_type_id) DO NOTHING;
  END IF;
END $$;

-- Старый столбец больше не нужен (зависимый индекс idx_rates_cost_type_id Postgres удалит сам).
ALTER TABLE rates DROP COLUMN IF EXISTS cost_type_id;

COMMIT;
