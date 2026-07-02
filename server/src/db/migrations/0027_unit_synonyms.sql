-- Синонимы единиц измерения: варианты записи одной и той же единицы
-- (м2/м²/кв.м, шт/шт./штука, компл/комплект …). Экспорт сметы (БСМ/БСР) использует их,
-- чтобы не считать один материал/работу конфликтующими из-за разного написания ед.изм.

ALTER TABLE units ADD COLUMN IF NOT EXISTS synonyms TEXT[] NOT NULL DEFAULT '{}';

-- Засев типовых синонимов: только для канонической единицы, у которой синонимы ещё не заданы
-- (чтобы не затирать ручные правки; сопоставление — без регистра и пробелов). Из списка
-- исключаем само название канонической единицы (array_remove).

-- Квадратный метр
UPDATE units SET synonyms = array_remove(
  ARRAY['м2','м²','кв.м','кв. м','м.кв','м.кв.','квадратный метр'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('м2','м²','кв.м','м.кв','м.кв.','квадратныйметр');

-- Кубический метр
UPDATE units SET synonyms = array_remove(
  ARRAY['м3','м³','куб.м','куб. м','м.куб','м.куб.','кубический метр'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('м3','м³','куб.м','м.куб','м.куб.','кубическийметр');

-- Метр / погонный метр
UPDATE units SET synonyms = array_remove(
  ARRAY['м','м.','метр','пог.м','пог. м','п.м','м.п.','м.п','мп','погонный метр'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('м','м.','метр','пог.м','п.м','м.п.','м.п','мп','погонныйметр');

-- Штука
UPDATE units SET synonyms = array_remove(
  ARRAY['шт','шт.','штука','штук','штуки'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('шт','шт.','штука','штук','штуки');

-- Комплект
UPDATE units SET synonyms = array_remove(
  ARRAY['компл','компл.','комплект','к-т','ком-т'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('компл','компл.','комплект','к-т','ком-т');

-- Тонна
UPDATE units SET synonyms = array_remove(
  ARRAY['т','тн','тонна','т.'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('т','тн','тонна','т.');

-- Килограмм
UPDATE units SET synonyms = array_remove(
  ARRAY['кг','кг.','килограмм'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('кг','кг.','килограмм');

-- Литр
UPDATE units SET synonyms = array_remove(
  ARRAY['л','л.','литр'], name)
WHERE (synonyms IS NULL OR synonyms = '{}')
  AND lower(regexp_replace(trim(name), '\s+', '', 'g')) IN ('л','л.','литр');
