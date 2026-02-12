-- =============================================================================
-- Migration 4: Purchase Requests and Financing
-- EstiMat - Construction Materials Procurement System
-- =============================================================================
-- Creates: purchase_requests, pr_items, distribution_letters, advances
-- Functions: recalc_pr_total(), on_request_approved()
-- Implements the three funding tracks:
--   gp_supply    -> updates pr_items status to 'pending'
--   obs_letter   -> creates distribution_letters record
--   advance      -> creates advances record
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Purchase Requests
-- Central request entity with funding_type determining the downstream flow.
-- ---------------------------------------------------------------------------
CREATE TABLE purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  funding_type TEXT NOT NULL
    CHECK (funding_type IN ('gp_supply', 'obs_letter', 'advance')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'review', 'approved', 'in_progress', 'fulfilled', 'cancelled')),
  total NUMERIC DEFAULT 0,
  deadline DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- PR Items (pozitsii zayavki)
-- ---------------------------------------------------------------------------
CREATE TABLE pr_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  estimate_item_id UUID REFERENCES estimate_items(id),
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  required_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_tender', 'ordered', 'delivered', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Distribution Letters (raspredilitelnye pisma / OBS)
-- Dual-track approval: RP review -> RP approved -> OBS review -> OBS approved
-- ---------------------------------------------------------------------------
CREATE TABLE distribution_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id),
  obs_account TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  payment_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'rp_review', 'rp_approved', 'obs_review', 'obs_approved', 'paid', 'cancelled')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Advances (avansirovaniye)
-- Internal GP approval flow: draft -> review -> approved -> paid
-- ---------------------------------------------------------------------------
CREATE TABLE advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  amount NUMERIC NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'paid', 'cancelled')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Indexes on all FK and status columns
-- ===========================================================================
CREATE INDEX idx_purchase_requests_project ON purchase_requests(project_id);
CREATE INDEX idx_purchase_requests_estimate ON purchase_requests(estimate_id);
CREATE INDEX idx_purchase_requests_contractor ON purchase_requests(contractor_id);
CREATE INDEX idx_purchase_requests_created_by ON purchase_requests(created_by);
CREATE INDEX idx_purchase_requests_approved_by ON purchase_requests(approved_by);
CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX idx_purchase_requests_funding_type ON purchase_requests(funding_type);

CREATE INDEX idx_pr_items_request ON pr_items(request_id);
CREATE INDEX idx_pr_items_estimate_item ON pr_items(estimate_item_id);
CREATE INDEX idx_pr_items_material ON pr_items(material_id);
CREATE INDEX idx_pr_items_status ON pr_items(status);

CREATE INDEX idx_distribution_letters_request ON distribution_letters(request_id);
CREATE INDEX idx_distribution_letters_approved_by ON distribution_letters(approved_by);
CREATE INDEX idx_distribution_letters_status ON distribution_letters(status);

CREATE INDEX idx_advances_request ON advances(request_id);
CREATE INDEX idx_advances_contractor ON advances(contractor_id);
CREATE INDEX idx_advances_approved_by ON advances(approved_by);
CREATE INDEX idx_advances_status ON advances(status);

-- ===========================================================================
-- Recalculation trigger: purchase_requests.total
-- Sums unit_price (from material_catalog or estimate_items) * quantity
-- for all pr_items. Since pr_items don't have a price column, we recalculate
-- based on the count of items * average or just re-sum from estimate_items.
-- In practice, total is set from the estimate. We recalculate as sum of
-- linked estimate_item totals proportioned by quantity.
-- For simplicity, total = SUM(pr_items.quantity * estimate_items.unit_price)
-- where the link exists, or 0 otherwise.
-- ===========================================================================
CREATE OR REPLACE FUNCTION recalc_pr_total() RETURNS TRIGGER AS $$
DECLARE
  v_request_id UUID;
BEGIN
  v_request_id := COALESCE(NEW.request_id, OLD.request_id);

  UPDATE purchase_requests SET total = (
    SELECT COALESCE(SUM(pri.quantity * COALESCE(ei.unit_price, 0)), 0)
    FROM pr_items pri
    LEFT JOIN estimate_items ei ON ei.id = pri.estimate_item_id
    WHERE pri.request_id = v_request_id
  ), updated_at = now()
  WHERE id = v_request_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pr_recalc
  AFTER INSERT OR UPDATE OR DELETE ON pr_items
  FOR EACH ROW EXECUTE FUNCTION recalc_pr_total();

-- ===========================================================================
-- on_request_approved() trigger
-- Fires when purchase_requests.status changes to 'approved'.
-- Routes by funding_type:
--   gp_supply   -> update all pr_items status to 'pending'
--   obs_letter  -> create a distribution_letters record
--   advance     -> create an advances record
-- ===========================================================================
CREATE OR REPLACE FUNCTION on_request_approved() RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status transitions to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status <> 'approved') THEN

    IF NEW.funding_type = 'gp_supply' THEN
      -- Route: GP Supply -> set pr_items to 'pending' (ready for tender)
      UPDATE pr_items
      SET status = 'pending', updated_at = now()
      WHERE request_id = NEW.id;

    ELSIF NEW.funding_type = 'obs_letter' THEN
      -- Route: Distribution letter -> create distribution_letters record
      INSERT INTO distribution_letters (request_id, obs_account, amount, status)
      VALUES (
        NEW.id,
        '',  -- obs_account to be filled in by finance
        COALESCE(NEW.total, 0),
        'draft'
      );

    ELSIF NEW.funding_type = 'advance' THEN
      -- Route: Advance -> create advances record
      INSERT INTO advances (request_id, contractor_id, amount, status)
      VALUES (
        NEW.id,
        NEW.contractor_id,
        COALESCE(NEW.total, 0),
        'draft'
      );

    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_on_request_approved
  AFTER UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION on_request_approved();

-- ===========================================================================
-- Audit triggers
-- ===========================================================================
CREATE TRIGGER trg_audit_purchase_requests
  AFTER INSERT OR UPDATE OR DELETE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_pr_items
  AFTER INSERT OR UPDATE OR DELETE ON pr_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_distribution_letters
  AFTER INSERT OR UPDATE OR DELETE ON distribution_letters
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_advances
  AFTER INSERT OR UPDATE OR DELETE ON advances
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
CREATE TRIGGER trg_updated_purchase_requests
  BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_pr_items
  BEFORE UPDATE ON pr_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_distribution_letters
  BEFORE UPDATE ON distribution_letters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_advances
  BEFORE UPDATE ON advances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
