-- 0028: личный кабинет подрядчика.
--   * project_contractors — явная связь объект↔организация-субподрядчик (какие объекты
--     видит подрядчик); backfill из существующих построчных назначений, чтобы не потерять
--     текущую видимость. Далее связка авто-поддерживается при назначении строк подрядчику.
--   * material_requests / material_request_items — заявки подрядчика на поставку материалов;
--     заявка сразу считается подтверждённой (status='confirmed'; поле зарезервировано на будущее).
--     Строки заявок НЕ уникальны — это история; «Заказано» = SUM(quantity) по (cost_type_id, agg_key).
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- ============================================================
-- 1. project_contractors — связь объект↔организация-подрядчик
-- ============================================================
CREATE TABLE IF NOT EXISTS project_contractors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id)      ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, contractor_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_project_id    ON project_contractors(project_id);
CREATE INDEX IF NOT EXISTS idx_pc_contractor_id ON project_contractors(contractor_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pc_updated_at') THEN
    CREATE TRIGGER trg_pc_updated_at
      BEFORE UPDATE ON project_contractors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- contractor_id обязан быть организацией-подрядчиком (subcontractor / general_contractor).
CREATE OR REPLACE FUNCTION validate_project_contractor() RETURNS TRIGGER AS $$
DECLARE
  v_org_type TEXT;
BEGIN
  SELECT type INTO v_org_type FROM organizations WHERE id = NEW.contractor_id;
  IF v_org_type IS NULL OR v_org_type NOT IN ('subcontractor', 'general_contractor') THEN
    RAISE EXCEPTION 'Организация % не является подрядчиком (subcontractor/general_contractor)', NEW.contractor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pc_validate') THEN
    CREATE TRIGGER trg_pc_validate
      BEFORE INSERT OR UPDATE ON project_contractors
      FOR EACH ROW EXECUTE FUNCTION validate_project_contractor();
  END IF;
END $$;

-- Backfill: подрядчики, у которых уже есть назначенные строки, продолжают видеть свои объекты.
INSERT INTO project_contractors (project_id, contractor_id)
SELECT DISTINCT e.project_id, eic.contractor_id
  FROM estimate_item_contractors eic
  JOIN estimates e ON e.id = eic.estimate_id
 WHERE e.project_id IS NOT NULL
ON CONFLICT (project_id, contractor_id) DO NOTHING;

-- ============================================================
-- 2. Заявки на материалы
-- ============================================================
CREATE TABLE IF NOT EXISTS material_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id   UUID NOT NULL REFERENCES estimates(id)     ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id)               ON DELETE SET NULL,
  contractor_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'confirmed',
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_request_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  cost_type_id  UUID REFERENCES cost_types(id) ON DELETE SET NULL,   -- для группировки «Заказано» по виду работ
  agg_key       TEXT NOT NULL,                                       -- ключ свёртки материала (id:<uuid>|<ед> либо txt:<name>|<ед>)
  material_id   UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
  material_name TEXT NOT NULL,
  unit          TEXT NOT NULL,
  quantity      NUMERIC NOT NULL CHECK (quantity > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mr_estimate_contractor ON material_requests(estimate_id, contractor_id, status);
CREATE INDEX IF NOT EXISTS idx_mri_request_id          ON material_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_mri_costtype_aggkey     ON material_request_items(cost_type_id, agg_key);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mr_updated_at') THEN
    CREATE TRIGGER trg_mr_updated_at
      BEFORE UPDATE ON material_requests
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
