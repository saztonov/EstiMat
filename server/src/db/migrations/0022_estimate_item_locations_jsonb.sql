-- 0022: мультилокация строки сметы — массив локаций в JSONB.
-- Одна строка работы может относиться к нескольким зонам и точному набору этажей
-- (с «дырками»: 1-4,6 = {1,2,3,4,6}). Источник истины — estimate_items.locations:
--   [ { "zoneId": "<uuid|null>", "floors": [1,2,3,4,6] }, ... ]
--   floors: [] — этажи не заданы («весь корпус»).
-- Легаси-колонки zone_id/floor_from/floor_to остаются как производное «первичное»
-- зеркало (первая зона; min/max этажей) — их пересчитывает сервер при каждой записи;
-- на них опираются ORDER BY, JOIN за zone_name, тиражирование и разрез.
-- Аддитивно и идемпотентно.

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS locations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Бэкфилл: переносим существующую одиночную локацию в массив.
-- Только строки, где locations ещё пуст и есть старая координата (повторный накат безопасен).
UPDATE estimate_items
SET locations = jsonb_build_array(
  jsonb_build_object(
    'zoneId', zone_id,
    'floors', CASE
      WHEN floor_from IS NOT NULL AND floor_to IS NOT NULL
        THEN (SELECT COALESCE(jsonb_agg(g), '[]'::jsonb)
              FROM generate_series(estimate_items.floor_from, estimate_items.floor_to) AS g)
      WHEN floor_from IS NOT NULL THEN jsonb_build_array(floor_from)
      WHEN floor_to   IS NOT NULL THEN jsonb_build_array(floor_to)
      ELSE '[]'::jsonb
    END
  )
)
WHERE locations = '[]'::jsonb
  AND (zone_id IS NOT NULL OR floor_from IS NOT NULL OR floor_to IS NOT NULL);

-- GIN-индекс на будущее (серверный отбор: locations @> '[{"zoneId":"…"}]').
CREATE INDEX IF NOT EXISTS idx_estimate_items_locations
  ON estimate_items USING gin (locations jsonb_path_ops);
