-- =============================================================================
-- Migration 6: Delivery, Acceptance, Transfers, and Claims
-- EstiMat - Construction Materials Procurement System
-- =============================================================================
-- Creates: deliveries, delivery_items, acceptance_docs, material_transfers,
--          material_sales, material_writeoffs, claims
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Deliveries (postavki)
-- Tracks shipments from suppliers to project sites.
-- ---------------------------------------------------------------------------
CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'shipped'
    CHECK (status IN ('shipped', 'delivered', 'accepted', 'partially_accepted', 'rejected')),
  tracking TEXT,
  expected_date DATE,
  actual_date DATE,
  receiver_type TEXT CHECK (receiver_type IN ('contractor', 'brigade')),
  receiver_id UUID REFERENCES organizations(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Delivery Items (pozitsii postavki)
-- Each item maps to a PO item with shipped/accepted/rejected quantities.
-- ---------------------------------------------------------------------------
CREATE TABLE delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  po_item_id UUID NOT NULL REFERENCES po_items(id),
  shipped_qty NUMERIC NOT NULL,
  accepted_qty NUMERIC DEFAULT 0,
  rejected_qty NUMERIC DEFAULT 0,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Acceptance Documents (dokumenty priyomki)
-- Photos, acts, certificates attached to a delivery.
-- ---------------------------------------------------------------------------
CREATE TABLE acceptance_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('act', 'photo', 'certificate', 'other')),
  file_path TEXT NOT NULL,
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Material Transfers (M-15: peredacha davalcheskikh materialov)
-- Transfer of customer-supplied materials to contractor.
-- ---------------------------------------------------------------------------
CREATE TABLE material_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL DEFAULT 'davalcheskie'
    CHECK (type IN ('davalcheskie')),
  doc_number TEXT NOT NULL,
  doc_date DATE NOT NULL,
  items JSONB NOT NULL,
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'signed', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Material Sales (prodazha materialov podryadchiku)
-- Sale of materials to contractor (non-davalcheskie flow).
-- ---------------------------------------------------------------------------
CREATE TABLE material_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  invoice_number TEXT,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'invoiced', 'paid', 'cancelled')),
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Material Writeoffs (spisaniye materialov dlya brigady)
-- Writing off materials consumed by in-house brigade.
-- ---------------------------------------------------------------------------
CREATE TABLE material_writeoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  site_id UUID REFERENCES sites(id),
  writeoff_date DATE NOT NULL,
  items JSONB NOT NULL,
  approved_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Claims (pretenzii)
-- Quality, quantity, damage, or delay claims against a delivery.
-- ---------------------------------------------------------------------------
CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  type TEXT NOT NULL
    CHECK (type IN ('quantity', 'quality', 'damage', 'delay', 'other')),
  description TEXT NOT NULL,
  amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolution TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Indexes on all FK and status columns
-- ===========================================================================
CREATE INDEX idx_deliveries_order ON deliveries(order_id);
CREATE INDEX idx_deliveries_project ON deliveries(project_id);
CREATE INDEX idx_deliveries_receiver ON deliveries(receiver_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);

CREATE INDEX idx_delivery_items_delivery ON delivery_items(delivery_id);
CREATE INDEX idx_delivery_items_po_item ON delivery_items(po_item_id);

CREATE INDEX idx_acceptance_docs_delivery ON acceptance_docs(delivery_id);
CREATE INDEX idx_acceptance_docs_signed_by ON acceptance_docs(signed_by);

CREATE INDEX idx_material_transfers_delivery ON material_transfers(delivery_id);
CREATE INDEX idx_material_transfers_contractor ON material_transfers(contractor_id);
CREATE INDEX idx_material_transfers_signed_by ON material_transfers(signed_by);
CREATE INDEX idx_material_transfers_status ON material_transfers(status);

CREATE INDEX idx_material_sales_delivery ON material_sales(delivery_id);
CREATE INDEX idx_material_sales_contractor ON material_sales(contractor_id);
CREATE INDEX idx_material_sales_status ON material_sales(status);

CREATE INDEX idx_material_writeoffs_delivery ON material_writeoffs(delivery_id);
CREATE INDEX idx_material_writeoffs_project ON material_writeoffs(project_id);
CREATE INDEX idx_material_writeoffs_site ON material_writeoffs(site_id);
CREATE INDEX idx_material_writeoffs_approved_by ON material_writeoffs(approved_by);
CREATE INDEX idx_material_writeoffs_status ON material_writeoffs(status);

CREATE INDEX idx_claims_delivery ON claims(delivery_id);
CREATE INDEX idx_claims_created_by ON claims(created_by);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_type ON claims(type);

-- ===========================================================================
-- Audit triggers
-- ===========================================================================
CREATE TRIGGER trg_audit_deliveries
  AFTER INSERT OR UPDATE OR DELETE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_delivery_items
  AFTER INSERT OR UPDATE OR DELETE ON delivery_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_acceptance_docs
  AFTER INSERT OR UPDATE OR DELETE ON acceptance_docs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_material_transfers
  AFTER INSERT OR UPDATE OR DELETE ON material_transfers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_material_sales
  AFTER INSERT OR UPDATE OR DELETE ON material_sales
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_material_writeoffs
  AFTER INSERT OR UPDATE OR DELETE ON material_writeoffs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER trg_audit_claims
  AFTER INSERT OR UPDATE OR DELETE ON claims
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
CREATE TRIGGER trg_updated_deliveries
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_material_transfers
  BEFORE UPDATE ON material_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_material_sales
  BEFORE UPDATE ON material_sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_material_writeoffs
  BEFORE UPDATE ON material_writeoffs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_updated_claims
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
