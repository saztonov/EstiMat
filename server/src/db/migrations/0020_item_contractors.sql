-- 0017: подрядчики на уровне строки сметы (с учётом локации — локация уже на строке).
--   * назначение хранится в estimate_item_contractors: строка работы + организация-подрядчик;
--   * на одну строку можно назначить НЕСКОЛЬКО подрядчиков (UNIQUE по паре item+contractor);
--   * для каждого подрядчика — либо абсолютный объём (assigned_qty), либо процент (assigned_percent),
--     либо «весь объём» (оба NULL, допустимо только если подрядчик на строке один.
-- Сосуществует со старой estimate_contractors (подрядчик на вид затрат целиком) — её не трогаем.
-- Аддитивная и идемпотентная миграция.

CREATE TABLE IF NOT EXISTS estimate_item_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          UUID NOT NULL REFERENCES estimate_items(id) ON DELETE CASCADE,
  estimate_id      UUID NOT NULL REFERENCES estimates(id)      ON DELETE CASCADE,
  contractor_id    UUID NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  assigned_qty     NUMERIC,     -- абсолютный объём по строке (nullable)
  assigned_percent NUMERIC,     -- процент от объёма строки 0..100 (nullable)
  assigned_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, contractor_id),                                          -- один подрядчик на строку не дублируется
  CHECK (NOT (assigned_qty IS NOT NULL AND assigned_percent IS NOT NULL)),  -- qty и percent взаимоисключающие
  CHECK (assigned_qty IS NULL OR assigned_qty > 0),
  CHECK (assigned_percent IS NULL OR (assigned_percent > 0 AND assigned_percent <= 100))
);

CREATE INDEX IF NOT EXISTS idx_eic_item_id       ON estimate_item_contractors(item_id);
CREATE INDEX IF NOT EXISTS idx_eic_estimate_id   ON estimate_item_contractors(estimate_id);
CREATE INDEX IF NOT EXISTS idx_eic_contractor_id ON estimate_item_contractors(contractor_id);

-- updated_at автообновление (как у прочих таблиц)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_eic_updated_at') THEN
    CREATE TRIGGER trg_eic_updated_at
      BEFORE UPDATE ON estimate_item_contractors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Инварианты, невыразимые через CHECK (кросс-табличные) — проверяются триггером:
--   1) estimate_id назначения обязан совпадать с estimate_id строки (защита от записи строки чужой сметы);
--   2) contractor_id обязан быть организацией-подрядчиком (subcontractor / general_contractor);
--   3) «весь объём» (оба NULL) допустим только когда подрядчик на строке единственный.
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

  IF NEW.assigned_qty IS NULL AND NEW.assigned_percent IS NULL THEN
    -- текущий подрядчик берёт «весь объём» — других быть не должно
    IF EXISTS (SELECT 1 FROM estimate_item_contractors
               WHERE item_id = NEW.item_id AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Объём не указан, но на строке % уже есть другой подрядчик', NEW.item_id;
    END IF;
  ELSE
    -- у текущего указан объём — существующая запись «весь объём» становится недопустимой
    IF EXISTS (SELECT 1 FROM estimate_item_contractors
               WHERE item_id = NEW.item_id AND id <> NEW.id
                 AND assigned_qty IS NULL AND assigned_percent IS NULL) THEN
      RAISE EXCEPTION 'На строке % уже есть подрядчик на весь объём — задайте ему объём/процент', NEW.item_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_eic_validate') THEN
    CREATE TRIGGER trg_eic_validate
      BEFORE INSERT OR UPDATE ON estimate_item_contractors
      FOR EACH ROW EXECUTE FUNCTION validate_item_contractor();
  END IF;
END $$;
