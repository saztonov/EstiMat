-- 0039: восстановление связи «Заказано» после привязки материалов к справочнику.
--
-- При согласовании текстовый материал получает material_id (mirrorMaterialsToCatalog), из-за чего
-- ключ свёртки agg_key меняется с txt:<имя>|<ед> на id:<material_id>|<ед>. Ранее созданные строки
-- заявок (material_request_items) остаются под старым txt-ключом и перестают матчиться с позицией
-- сметы — колонка «Заказано» у подрядчика опустошается, хотя сама заявка цела.
--
-- Переносим строки заявок на новый id-ключ, но ТОЛЬКО для полностью и однозначно разрешённого
-- бакета: все видимые подрядчику вхождения (тот же вид работ + нормализованные имя/ед) уже
-- привязаны к каталогу и дают ровно один material_id. Частичное согласование (остались txt-строки),
-- неоднозначность (>1 distinct material_id) или отсутствие кандидата — осознанно НЕ трогаем.
--
-- Идемпотентно (после переноса agg_key уже id: и под LIKE 'txt:%' не попадает), не меняет
-- material_name/unit/quantity — только внутренний ключ связи. Один чистый SQL-стейтмент
-- (совместимо с deploy-estimat --migrate).

WITH tgt AS (
  SELECT mri.id AS mri_id,
         (array_agg(DISTINCT em.material_id))[1] AS mat_id,
         lower(btrim(mri.unit)) AS unit_norm
    FROM material_request_items mri
    JOIN material_requests mr ON mr.id = mri.request_id
    JOIN estimate_items ei
      ON ei.estimate_id = mr.estimate_id
     AND ei.cost_type_id IS NOT DISTINCT FROM mri.cost_type_id
    JOIN estimate_item_contractors eic
      ON eic.item_id = ei.id AND eic.contractor_id = mr.contractor_id
    JOIN estimate_materials em ON em.item_id = ei.id
   WHERE mri.agg_key LIKE 'txt:%'
     AND lower(btrim(em.description)) = lower(btrim(mri.material_name))
     AND lower(btrim(em.unit))        = lower(btrim(mri.unit))
   GROUP BY mri.id, lower(btrim(mri.unit))
  HAVING count(*) FILTER (WHERE em.material_id IS NULL) = 0
     AND count(DISTINCT em.material_id) = 1
)
UPDATE material_request_items mri
   SET agg_key = 'id:' || tgt.mat_id::text || '|' || tgt.unit_norm,
       material_id = tgt.mat_id
  FROM tgt
 WHERE mri.id = tgt.mri_id;
