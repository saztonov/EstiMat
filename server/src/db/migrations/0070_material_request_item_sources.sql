-- 0070_material_request_item_sources.sql
-- Точная связь «позиция заявки на материалы ↔ строки сметы, из которых она свёрнута».
--
-- Позиция заявки (material_request_items) — свёртка по (cost_type_id, agg_key): один ключ дают
-- материалы НЕСКОЛЬКИХ estimate_items (разные работы одного вида работ), а для su10 позиция ещё
-- размножается по датам поставки. Прямой связи со сметой не было, поэтому нельзя было ответить на
-- вопрос «есть ли по ЭТОЙ строке сметы заказ у ЭТОГО подрядчика». Он нужен разделу «Подрядчики»:
-- переназначение подрядчика на строку, по которой уже заказаны материалы, осиротило бы заявку.
--
-- item_id БЕЗ внешнего ключа — сознательно. Undo восстанавливает удалённую строку сметы с ТЕМ ЖЕ
-- id (lib/undo.ts, insertFromSnapshot по entity_id), а ON DELETE CASCADE снёс бы связь безвозвратно:
-- строка вернулась бы уже без защиты, причём link_resolution='exact' отключил бы и запасной путь.
-- Храним исторический указатель; планировщик защиты джойнит его с существующими estimate_items,
-- поэтому висячий item_id (строка удалена насовсем) ничего не блокирует.
--
-- Аддитивно и идемпотентно, один батч (deploy-estimat --migrate): CREATE TABLE/INDEX IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING, UPDATE под условием.
-- Триггер-мост на окно деплоя НЕ нужен: пока работает старый API, новые позиции остаются
-- 'unresolved' и попадают под запасную блокировку по виду работ, то есть блокируют ШИРЕ, а не уже.

CREATE TABLE IF NOT EXISTS material_request_item_sources (
  request_item_id UUID NOT NULL REFERENCES material_request_items(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL,   -- estimate_items(id), намеренно без FK (см. шапку)
  PRIMARY KEY (request_item_id, item_id)   -- индекс по ведущему request_item_id — из PK
);

-- Обратное направление: «какие заявки держат эту строку сметы» — горячий путь проверки защиты.
CREATE INDEX IF NOT EXISTS ix_mris_item ON material_request_item_sources(item_id);

-- Качество связи, а не факт её наличия:
--   exact         — записана при создании/доработке заявки из канонической сводки материалов;
--   reconstructed — восстановлена бэкфиллом ниже (best-effort: назначения подрядчика могли
--                   измениться после оформления заявки, историческую точность не доказать);
--   unresolved    — связи нет → консервативная блокировка по виду работ.
-- Отдельная колонка, а не «есть ли строки в material_request_item_sources»: иначе удаление строк
-- сметы со временем превращало бы актуальные заявки в неразрешённые и расширяло блокировку.
ALTER TABLE material_request_items
  ADD COLUMN IF NOT EXISTS link_resolution TEXT NOT NULL DEFAULT 'unresolved';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'material_request_items'::regclass
       AND conname = 'material_request_items_link_resolution_check'
  ) THEN
    ALTER TABLE material_request_items
      ADD CONSTRAINT material_request_items_link_resolution_check
      CHECK (link_resolution IN ('exact', 'reconstructed', 'unresolved'));
  END IF;
END $$;

-- Бэкфилл по образцу 0039_relink_material_requests_catalog.sql: реконструируем agg_key из
-- estimate_materials ТЕМ ЖЕ выражением, что даёт aggKey() в shared/src/keys/material-keys.ts
-- (id:<material_id>|<ед> либо txt:<нормализованное имя>|<ед>), и связываем позицию заявки со ВСЕМИ
-- строками сметы, которые этот ключ дают, — в пределах сметы заявки, вида работ позиции и текущих
-- назначений подрядчика (те же условия, что в loadVisibleMaterials).
--
-- Проверки на неоднозначность (HAVING в 0039) здесь НЕ нужны: связь по построению «одна позиция —
-- много строк сметы», несколько совпадений это норма, а не конфликт. Позиции, для которых смета с
-- момента заявки изменилась (материал переименован, получил material_id, назначение снято), не
-- сматчатся и останутся 'unresolved' — по ним работает блокировка по виду работ.
INSERT INTO material_request_item_sources (request_item_id, item_id)
SELECT DISTINCT mri.id, ei.id
  FROM material_request_items mri
  JOIN material_requests mr ON mr.id = mri.request_id
  JOIN estimate_items ei
    ON ei.estimate_id = mr.estimate_id
   AND ei.cost_type_id IS NOT DISTINCT FROM mri.cost_type_id
  JOIN estimate_item_contractors eic
    ON eic.item_id = ei.id AND eic.contractor_id = mr.contractor_id
  JOIN estimate_materials em ON em.item_id = ei.id
  LEFT JOIN material_catalog mc ON mc.id = em.material_id
 WHERE mri.link_resolution = 'unresolved'
   AND mri.agg_key = CASE
         WHEN em.material_id IS NOT NULL
           THEN 'id:' || em.material_id::text || '|' || lower(btrim(em.unit))
         ELSE 'txt:' || lower(btrim(COALESCE(mc.name, em.description, 'Материал')))
                     || '|' || lower(btrim(em.unit))
       END
ON CONFLICT DO NOTHING;

-- Разрешённой считаем связь только там, где бэкфилл что-то нашёл.
UPDATE material_request_items mri
   SET link_resolution = 'reconstructed'
 WHERE mri.link_resolution = 'unresolved'
   AND EXISTS (SELECT 1 FROM material_request_item_sources s WHERE s.request_item_id = mri.id);
