-- =============================================================================
-- Migration 5: Tenders, Contracts, and Purchase Orders
-- EstiMat - Construction Materials Procurement System
-- =============================================================================
-- Creates: contracts, tenders, tender_lots, tender_lot_requests,
--          long_term_orders, purchase_orders, po_items
-- Functions: recalc_po_total()
-- Note: contracts is created BEFORE long_term_orders (FK dependency)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Contracts (spravochnik dogovorov)
-- Reference table for supplier contracts, created in advance.
-- ---------------------------------------------------------------------------
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID REFERENCES projects(id),
  number TEXT NOT NULL,
  date DATE NOT NULL,
  valid_until DATE,
  terms JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  total_amount NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tenders
-- Consolidates approved gp_supply requests by material group for a period.
-- ---------------------------------------------------------------------------
CREATE TABLE tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  material_group_id UUID REFERENCES material_groups(id),
  type TEXT NOT NULL CHECK (type IN ('tender', 'non_tender')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'bidding', 'evaluation', 'awarded', 'completed', 'cancelled')),
  period_start DATE,
  period_end DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tender Lots
-- Individual material lines within a tender.
-- ---------------------------------------------------------------------------
CREATE TABLE tender_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  total_quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  specifications JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tender Lot Requests (junction: lot <-> pr_item)
-- Links tender lots back to the original purchase request items.
-- ---------------------------------------------------------------------------
CREATE TABLE tender_lot_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES tender_lots(id) ON DELETE CASCADE,
  pr_item_id UUID NOT NULL REFERENCES pr_items(id),
  UNIQUE(lot_id, pr_item_id)
);

-- ---------------------------------------------------------------------------
-- Long-Term Orders
-- Alternative to tender: orders placed under existing long-term contracts.
-- ---------------------------------------------------------------------------
CREATE TABLE long_term_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  required_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'ordered', 'delivered')),
  pr_item_id UUID REFERENCES pr_items(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Purchase Orders (zakazy postavshchikam)
-- Created from tender results or long-term orders.
-- total is auto-recalculated by trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id),
  tender_id UUID REFERENCES tenders(id),
  long_term_order_id UUID REFERENCES long_term_orders(id),
  supplier_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'in_delivery', 'delivered', 'closed', 'cancelled')),
  total NUMERIC DEFAULT 0,
  payment_terms TEXT,
  delivery_date DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- PO Items (pozitsii zakaza)
-- total is a generated column: quantity * unit_price.
-- ---------------------------------------------------------------------------
CREATE TABLE po_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  lot_id UUID REFERENCES tender_lots(id),
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Indexes on all FK and status columns
-- ===========================================================================
CREATE INDEX idx_contracts_supplier ON contracts(supplier_id);
CREATE INDEX idx_contracts_project ON contracts(project_id);
CREATE INDEX idx_contracts_status ON contracts(status);

CREATE INDEX idx_tenders_project ON tenders(project_id);
CREATE INDEX idx_tenders_material_group ON tenders(material_group_id);
CREATE INDEX idx_tenders_created_by ON tenders(created_by);
CREATE INDEX idx_tenders_status ON tenders(status);

CREATE INDEX idx_tender_lots_tender ON tender_lots(tender_id);
CREATE INDEX idx_tender_lots_material ON tender_lots(material_id);

CREATE INDEX idx_tender_lot_requests_lot ON tender_lot_requests(lot_id);
CREATE INDEX idx_tender_lot_requests_pr_item ON tender_lot_requests(pr_item_id);

CREATE INDEX idx_long_term_orders_contract ON long_term_orders(contract_id);
CREATE INDEX idx_long_term_orders_material ON long_term_orders(material_id);
CREATE INDEX idx_long_term_orders_pr_item ON long_term_orders(pr_item_id);
CREATE INDEX idx_long_term_orders_created_by ON long_term_orders(created_by);
CREATE INDEX idx_long_term_orders_status ON long_term_orders(status);

CREATE INDEX idx_purchase_orders_contract ON purchase_orders(contract_id);
CREATE INDEX idx_purchase_orders_tender ON purchase_orders(tender_id);
CREATE INDEX idx_purchase_orders_long_term_order ON purchase_orders(long_term_order_id);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_project ON purchase_orders(project_id);
CREATE INDEX idx_purchase_orders_created_by ON purchase_orders(created_by);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);

CREATE INDEX idx_po_items_order ON po_items(order_id);
CREATE INDEX idx_po_items_material ON po_items(material_id);
CREATE INDEX idx_po_items_lot ON po_items(lot_id);

-- ===========================================================================
-- Recalculation trigger: purchase_orders.total
-- ===========================================================================
CREATE OR REPLACE FUNCTION recalc_po_total() RETURNS TRIGGER AS $$
DECLARE
  v_order_id UUID;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  UPDATE purchase_orders SET total = (
    SELECT COALESCE(SUM(total), 0)
    FROM po_items
    WHERE order_id = v_order_id
  ), updated_at = now()
  WHERE id = v_order_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_po_recalc
  AFTER INSERT OR UPDATE OR DELETE ON po_items
  FOR EACH ROW EXECUTE FUNCTION recalc_po_total();

-- ===========================================================================
-- Audit triggers
-- ===========================================================================
CREATE TRIGGER trg_audit_contracts
  AFTER INSERT OR UPDATE OR DELETE ON contracts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_tenders
  AFTER INSERT OR UPDATE OR DELETE ON tenders
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_tender_lots
  AFTER INSERT OR UPDATE OR DELETE ON tender_lots
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_long_term_orders
  AFTER INSERT OR UPDATE OR DELETE ON long_term_orders
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_purchase_orders
  AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_po_items
  AFTER INSERT OR UPDATE OR DELETE ON po_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
CREATE TRIGGER trg_updated_contracts
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_tenders
  BEFORE UPDATE ON tenders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_long_term_orders
  BEFORE UPDATE ON long_term_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_purchase_orders
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
