-- 0083: подрядчики ВОР (реквизиты договора) и упрощение назначений до «целиком на строку».
--   * estimate_vor_contractors — реестр договорных связок «ВОР → подрядчик»: номер/дата договора,
--     кто и когда назначил. Источник истины по фактическим назначениям — estimate_item_contractors
--     (кабинет подрядчика, заявки и договорные цены живут на ней); связка может пережить строки
--     (все строки сняты/удалены — договорные реквизиты остаются видны в реестре как «без строк»);
--   * механизм долей (assigned_qty / assigned_percent) удаляется: подрядчик берёт строку целиком,
--     новый инвариант «один исполнитель на строку» держит уникальный индекс uq_eic_item;
--   * парный UNIQUE (item_id, contractor_id) становится избыточным (любой дубль пары — дубль
--     item_id) и удаляется: ON CONFLICT в назначении переводится на (item_id).
-- Идемпотентная миграция.

-- 1) Реестр договорных связок «ВОР → подрядчик».
CREATE TABLE IF NOT EXISTS estimate_vor_contractors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vor_id          UUID NOT NULL REFERENCES estimate_vors(id)  ON DELETE CASCADE,
  contractor_id   UUID NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  contract_number TEXT,
  contract_date   DATE,
  assigned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vor_id, contractor_id)
);

CREATE INDEX IF NOT EXISTS idx_evc_contractor_id ON estimate_vor_contractors(contractor_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evc_updated_at') THEN
    CREATE TRIGGER trg_evc_updated_at
      BEFORE UPDATE ON estimate_vor_contractors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- 2) Механизм долей удаляется (боевые назначения очищены вручную; CHECK-и, ссылающиеся на
--    колонки, Postgres удаляет вместе с ними).
ALTER TABLE estimate_item_contractors
  DROP COLUMN IF EXISTS assigned_qty,
  DROP COLUMN IF EXISTS assigned_percent;

-- 3) Preflight: на dev/stage могли остаться несколько подрядчиков на строке — уникальный индекс
--    не построился бы. Оставляем самое свежее назначение на строку.
DELETE FROM estimate_item_contractors a
  USING estimate_item_contractors b
 WHERE a.item_id = b.item_id
   AND a.id <> b.id
   AND (a.assigned_at, a.id) < (b.assigned_at, b.id);

-- 4) Новый инвариант: один исполнитель на строку.
CREATE UNIQUE INDEX IF NOT EXISTS uq_eic_item ON estimate_item_contractors(item_id);

-- 5) Парная уникальность стала избыточной.
ALTER TABLE estimate_item_contractors
  DROP CONSTRAINT IF EXISTS estimate_item_contractors_item_id_contractor_id_key;

-- 6) Триггерная функция без веток про доли: остаются кросс-табличные проверки (соответствие
--    сметы и тип организации); единственность исполнителя обеспечивает uq_eic_item.
--    Триггер trg_eic_validate существует — CREATE OR REPLACE подменяет тело функции.
CREATE OR REPLACE FUNCTION validate_item_contractor() RETURNS TRIGGER AS $$
DECLARE
  v_estimate_id UUID;
  v_org_type    TEXT;
BEGIN
  SELECT estimate_id INTO v_estimate_id FROM estimate_items WHERE id = NEW.item_id;
  IF v_estimate_id IS NULL THEN
    RAISE EXCEPTION 'Строка сметы % не найдена', NEW.item_id;
  END IF;
  IF NEW.estimate_id <> v_estimate_id THEN
    RAISE EXCEPTION 'estimate_id назначения (%) не совпадает со сметой строки (%)', NEW.estimate_id, v_estimate_id;
  END IF;

  SELECT type INTO v_org_type FROM organizations WHERE id = NEW.contractor_id;
  IF v_org_type IS NULL OR v_org_type NOT IN ('subcontractor', 'general_contractor') THEN
    RAISE EXCEPTION 'Организация % не является подрядчиком (subcontractor/general_contractor)', NEW.contractor_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
