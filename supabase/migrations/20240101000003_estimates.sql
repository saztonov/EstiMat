-- =============================================================================
-- Migration 3: Estimates Module
-- EstiMat - Construction Materials Procurement System
-- =============================================================================
-- Creates: estimates, estimate_items
-- Functions: recalc_estimate_total()
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Estimates
-- Each estimate is tied to a project, a BOQ, and optionally a contractor.
-- total_amount is auto-recalculated by trigger when estimate_items change.
-- ---------------------------------------------------------------------------
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  boq_id UUID NOT NULL REFERENCES boq(id),
  contractor_id UUID REFERENCES organizations(id),
  work_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'archived')),
  total_amount NUMERIC DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Estimate Items
-- Each item links back to a boq_item for end-to-end traceability.
-- total is a generated column: quantity * unit_price.
-- ---------------------------------------------------------------------------
CREATE TABLE estimate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  boq_item_id UUID REFERENCES boq_items(id),
  description TEXT,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Indexes
-- ===========================================================================
CREATE INDEX idx_estimates_project ON estimates(project_id);
CREATE INDEX idx_estimates_boq ON estimates(boq_id);
CREATE INDEX idx_estimates_contractor ON estimates(contractor_id);
CREATE INDEX idx_estimates_created_by ON estimates(created_by);
CREATE INDEX idx_estimates_approved_by ON estimates(approved_by);
CREATE INDEX idx_estimates_status ON estimates(status);

CREATE INDEX idx_estimate_items_estimate ON estimate_items(estimate_id);
CREATE INDEX idx_estimate_items_boq_item ON estimate_items(boq_item_id);

-- ===========================================================================
-- Recalculation trigger function
-- Recalculates estimates.total_amount whenever estimate_items are
-- inserted, updated, or deleted.
-- ===========================================================================
CREATE OR REPLACE FUNCTION recalc_estimate_total() RETURNS TRIGGER AS $$
BEGIN
  UPDATE estimates SET total_amount = (
    SELECT COALESCE(SUM(total), 0)
    FROM estimate_items
    WHERE estimate_id = COALESCE(NEW.estimate_id, OLD.estimate_id)
  ), updated_at = now()
  WHERE id = COALESCE(NEW.estimate_id, OLD.estimate_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_estimate_recalc
  AFTER INSERT OR UPDATE OR DELETE ON estimate_items
  FOR EACH ROW EXECUTE FUNCTION recalc_estimate_total();

-- ===========================================================================
-- Audit triggers
-- ===========================================================================
CREATE TRIGGER trg_audit_estimates
  AFTER INSERT OR UPDATE OR DELETE ON estimates
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_estimate_items
  AFTER INSERT OR UPDATE OR DELETE ON estimate_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
CREATE TRIGGER trg_updated_estimates
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_estimate_items
  BEFORE UPDATE ON estimate_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
