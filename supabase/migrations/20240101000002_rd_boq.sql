-- =============================================================================
-- Migration 2: RD Volumes and BOQ (Bill of Quantities)
-- EstiMat - Construction Materials Procurement System
-- =============================================================================
-- Creates: rd_volumes, boq, boq_items, volume_calculations
-- Note: rd_volumes statuses are: uploaded, verified, approved, rejected
--       (NO processing, NO ai_analyzed -- AI part is deferred)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RD Volumes (toma rabochey dokumentatsii)
-- ---------------------------------------------------------------------------
CREATE TABLE rd_volumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  code TEXT,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'verified', 'approved', 'rejected')),
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  verified_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- BOQ - Bill of Quantities (vedomost obyomov rabot)
-- Groups specifications extracted from RD volumes
-- ---------------------------------------------------------------------------
CREATE TABLE boq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'archived')),
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- BOQ Items (pozitsii VOR)
-- Contains both work volumes and material volumes.
-- total is a generated column: material_quantity * unit_price
-- ai_confidence and raw_text are nullable for future AI integration.
-- ---------------------------------------------------------------------------
CREATE TABLE boq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id UUID NOT NULL REFERENCES boq(id) ON DELETE CASCADE,
  volume_id UUID REFERENCES rd_volumes(id),
  material_id UUID REFERENCES material_catalog(id),
  work_type TEXT,
  work_quantity NUMERIC,
  material_quantity NUMERIC,
  unit TEXT NOT NULL,
  unit_price NUMERIC,
  total NUMERIC GENERATED ALWAYS AS (COALESCE(material_quantity, 0) * COALESCE(unit_price, 0)) STORED,
  raw_text TEXT,
  ai_confidence REAL,
  section TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Volume Calculations
-- Parallel process by the RD analysis department for calculating volumes.
-- ---------------------------------------------------------------------------
CREATE TABLE volume_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  calculated_qty NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  coefficient NUMERIC DEFAULT 1.0,
  method TEXT,
  notes TEXT,
  calculated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Indexes on all FK columns
-- ===========================================================================
CREATE INDEX idx_rd_volumes_project ON rd_volumes(project_id);
CREATE INDEX idx_rd_volumes_uploaded_by ON rd_volumes(uploaded_by);
CREATE INDEX idx_rd_volumes_verified_by ON rd_volumes(verified_by);
CREATE INDEX idx_rd_volumes_status ON rd_volumes(status);

CREATE INDEX idx_boq_project ON boq(project_id);
CREATE INDEX idx_boq_created_by ON boq(created_by);
CREATE INDEX idx_boq_approved_by ON boq(approved_by);
CREATE INDEX idx_boq_status ON boq(status);

CREATE INDEX idx_boq_items_boq ON boq_items(boq_id);
CREATE INDEX idx_boq_items_volume ON boq_items(volume_id);
CREATE INDEX idx_boq_items_material ON boq_items(material_id);

CREATE INDEX idx_volume_calculations_boq_item ON volume_calculations(boq_item_id);
CREATE INDEX idx_volume_calculations_calculated_by ON volume_calculations(calculated_by);

-- ===========================================================================
-- Audit triggers
-- ===========================================================================
CREATE TRIGGER trg_audit_rd_volumes
  AFTER INSERT OR UPDATE OR DELETE ON rd_volumes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_boq
  AFTER INSERT OR UPDATE OR DELETE ON boq
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_boq_items
  AFTER INSERT OR UPDATE OR DELETE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_volume_calculations
  AFTER INSERT OR UPDATE OR DELETE ON volume_calculations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
CREATE TRIGGER trg_updated_rd_volumes
  BEFORE UPDATE ON rd_volumes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_boq
  BEFORE UPDATE ON boq
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_boq_items
  BEFORE UPDATE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_volume_calculations
  BEFORE UPDATE ON volume_calculations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
