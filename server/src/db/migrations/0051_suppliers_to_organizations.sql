-- 0051: перенос справочника поставщиков в общий справочник организаций (type='supplier').
--   Поставщики больше не хранятся отдельной таблицей suppliers и не привязаны к id BillHub —
--   получают собственные uuid организаций и видны в разделе «Организации» (фильтр по типу).
--   Дедуп: по ИНН (для записей без ИНН — по названию), не создавая дублей существующих организаций.
--   Идемпотентная: перенос выполняется только пока существует таблица suppliers.

DO $$
BEGIN
  IF to_regclass('public.suppliers') IS NOT NULL THEN
    INSERT INTO organizations (name, inn, type, is_active)
    SELECT DISTINCT ON (COALESCE(NULLIF(btrim(s.inn), ''), lower(btrim(s.name))))
           btrim(s.name),
           NULLIF(btrim(s.inn), ''),
           'supplier',
           true
      FROM suppliers s
     WHERE s.security_status IS DISTINCT FROM 'rejected'
       AND s.name IS NOT NULL AND btrim(s.name) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM organizations o
          WHERE (NULLIF(btrim(s.inn), '') IS NOT NULL AND o.inn = NULLIF(btrim(s.inn), ''))
             OR (NULLIF(btrim(s.inn), '') IS NULL AND lower(o.name) = lower(btrim(s.name)))
       )
     ORDER BY COALESCE(NULLIF(btrim(s.inn), ''), lower(btrim(s.name))), s.name;
  END IF;
END $$;

-- Прямой заказ ссылается на поставщика-организацию (было: на таблицу suppliers).
ALTER TABLE supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_supplier_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_orders_supplier_org_fk') THEN
    ALTER TABLE supplier_orders
      ADD CONSTRAINT supplier_orders_supplier_org_fk
      FOREIGN KEY (supplier_id) REFERENCES organizations(id);
  END IF;
END $$;

-- Отдельная таблица поставщиков больше не нужна.
DROP TABLE IF EXISTS suppliers;
