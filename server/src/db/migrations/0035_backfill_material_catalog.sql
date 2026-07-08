-- 0035: разовый backfill legacy-справочника material_catalog принятыми материалами смет,
--   которые ещё не привязаны к каталогу (появились до автозеркалирования при добавлении).
--
-- Повторяет логику server/src/lib/catalog.ts (mirrorMaterialsToCatalog): строит группы
-- Категория → Вид работ по именам cost_categories/cost_types родительской работы (дефолты
-- «Без категории»/«Без вида работ»), дедуп по lower(btrim(name)); находит/создаёт запись
-- material_catalog по (группа вида работ, name, unit) и проставляет estimate_materials.material_id.
--
-- Инвариант (как в catalog.ts): берём только material_id IS NULL AND needs_review = false.
--   Непроверенные ИИ-материалы (needs_review = true) законно остаются без ссылки и в справочник
--   НЕ попадают до ревью.
--
-- Совместимо с deploy-estimat --migrate: чистый SQL одним батчем, без psql-метакоманд.
-- Идемпотентно — повторный прогон обрабатывает лишь оставшиеся material_id IS NULL.
-- Детерминировано — при исторических дублях групп/материалов canonical выбирается как самый
--   ранний (ORDER BY created_at, id), а не произвольный.

-- 1. Недостающие категории (parent_id IS NULL): ровно одна на нормализованное имя.
INSERT INTO material_groups (name, parent_id)
SELECT g2.nm, NULL::uuid
FROM (
  SELECT btrim(MIN(cat_name)) AS nm, lower(btrim(cat_name)) AS norm
  FROM (
    SELECT COALESCE(NULLIF(btrim(cc.name), ''), 'Без категории') AS cat_name
    FROM estimate_materials m
    JOIN estimate_items w ON w.id = m.item_id
    LEFT JOIN cost_categories cc ON cc.id = w.cost_category_id
    WHERE m.material_id IS NULL AND m.needs_review = false
  ) s
  GROUP BY lower(btrim(cat_name))
) g2
WHERE NOT EXISTS (
  SELECT 1 FROM material_groups g
  WHERE g.parent_id IS NULL AND lower(btrim(g.name)) = g2.norm
);

-- 2. Недостающие виды работ (parent_id = категория): одна на (категория, нормализованное имя).
INSERT INTO material_groups (name, parent_id)
SELECT t.nm, t.cat_gid
FROM (
  SELECT btrim(MIN(type_name)) AS nm, lower(btrim(type_name)) AS type_norm, cat_gid
  FROM (
    SELECT COALESCE(NULLIF(btrim(ct.name), ''), 'Без вида работ') AS type_name,
           (SELECT g.id FROM material_groups g
             WHERE g.parent_id IS NULL
               AND lower(btrim(g.name)) = lower(btrim(COALESCE(NULLIF(btrim(cc.name), ''), 'Без категории')))
             ORDER BY g.created_at, g.id LIMIT 1) AS cat_gid
    FROM estimate_materials m
    JOIN estimate_items w ON w.id = m.item_id
    LEFT JOIN cost_categories cc ON cc.id = w.cost_category_id
    LEFT JOIN cost_types    ct ON ct.id = w.cost_type_id
    WHERE m.material_id IS NULL AND m.needs_review = false
  ) s
  GROUP BY cat_gid, lower(btrim(type_name))
) t
WHERE t.cat_gid IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM material_groups g
    WHERE g.parent_id = t.cat_gid AND lower(btrim(g.name)) = t.type_norm
  );

-- 3. Целевые материалы с вычисленной группой «Вид работ» (temp-таблица на время прогона).
DROP TABLE IF EXISTS tmp_backfill_mat;
CREATE TEMP TABLE tmp_backfill_mat AS
SELECT m.id AS mat_id,
       btrim(m.description) AS mdesc,
       btrim(m.unit) AS munit,
       COALESCE(m.unit_price, 0) AS mprice,
       m.created_at AS mcreated,
       (SELECT tg.id FROM material_groups tg
          WHERE tg.parent_id = (
            SELECT cg.id FROM material_groups cg
              WHERE cg.parent_id IS NULL
                AND lower(btrim(cg.name)) = lower(btrim(COALESCE(NULLIF(btrim(cc.name), ''), 'Без категории')))
              ORDER BY cg.created_at, cg.id LIMIT 1)
            AND lower(btrim(tg.name)) = lower(btrim(COALESCE(NULLIF(btrim(ct.name), ''), 'Без вида работ')))
          ORDER BY tg.created_at, tg.id LIMIT 1) AS type_gid
FROM estimate_materials m
JOIN estimate_items w ON w.id = m.item_id
LEFT JOIN cost_categories cc ON cc.id = w.cost_category_id
LEFT JOIN cost_types    ct ON ct.id = w.cost_type_id
WHERE m.material_id IS NULL AND m.needs_review = false;

-- 4. Недостающие записи справочника: одна на (группа, нормализованные name+unit).
--    Цена берётся от самого раннего материала группы (детерминированно).
INSERT INTO material_catalog (name, group_id, unit, unit_price)
SELECT d.mdesc, d.type_gid, d.munit, d.mprice
FROM (
  SELECT DISTINCT ON (type_gid, lower(mdesc), lower(munit))
         type_gid, mdesc, munit, mprice
  FROM tmp_backfill_mat
  WHERE type_gid IS NOT NULL
  ORDER BY type_gid, lower(mdesc), lower(munit), mcreated, mat_id
) d
WHERE NOT EXISTS (
  SELECT 1 FROM material_catalog c
  WHERE c.group_id = d.type_gid
    AND lower(btrim(c.name)) = lower(d.mdesc)
    AND lower(btrim(c.unit)) = lower(d.munit)
    AND c.is_active
);

-- 5. Обратная привязка: проставляем material_id (canonical запись справочника — самая ранняя).
UPDATE estimate_materials em
SET material_id = (
  SELECT c.id FROM material_catalog c
  WHERE c.group_id = t.type_gid
    AND lower(btrim(c.name)) = lower(t.mdesc)
    AND lower(btrim(c.unit)) = lower(t.munit)
    AND c.is_active
  ORDER BY c.created_at, c.id LIMIT 1)
FROM tmp_backfill_mat t
WHERE em.id = t.mat_id
  AND t.type_gid IS NOT NULL
  AND em.material_id IS NULL;

DROP TABLE IF EXISTS tmp_backfill_mat;
