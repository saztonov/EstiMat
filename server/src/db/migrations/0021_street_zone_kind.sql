-- 0021: добавляем kind 'street' (Улица) — наружная локация объекта, есть всегда.
-- CHECK пересоздаём (DROP+ADD не трогает строки). Идемпотентно.
ALTER TABLE project_zones DROP CONSTRAINT IF EXISTS project_zones_kind_check;
ALTER TABLE project_zones
  ADD CONSTRAINT project_zones_kind_check
  CHECK (kind IN ('building', 'parking', 'stylobate', 'section', 'roof', 'other', 'techfloor', 'street'));

-- Сидируем «Улицу» всем существующим объектам, у которых её ещё нет.
INSERT INTO project_zones (project_id, name, kind, sort_order)
SELECT p.id, 'Улица', 'street', 5
  FROM projects p
 WHERE NOT EXISTS (
   SELECT 1 FROM project_zones z WHERE z.project_id = p.id AND z.kind = 'street'
 );
