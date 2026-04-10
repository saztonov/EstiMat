-- EstiMat: Initial migration — 12 tables
-- Database-first: this SQL is the source of truth

-- ============================================
-- M7: Справочники
-- ============================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  inn TEXT,
  type TEXT NOT NULL CHECK (type IN ('client', 'general_contractor', 'subcontractor', 'supplier')),
  contacts JSONB DEFAULT '{}',
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  org_id UUID REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'engineer', 'contractor', 'manager')),
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  full_name TEXT,
  org_id UUID NOT NULL REFERENCES organizations(id),
  address TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed', 'archived')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  UNIQUE(project_id, user_id)
);

CREATE TABLE material_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES material_groups(id) ON DELETE CASCADE,
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE material_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  group_id UUID REFERENCES material_groups(id) ON DELETE SET NULL,
  unit TEXT NOT NULL,
  description TEXT,
  attributes JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Справочник расценок (категория → вид → расценка)
-- ============================================

CREATE TABLE cost_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cost_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES cost_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_type_id UUID NOT NULL REFERENCES cost_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  unit TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- M2: Сметный модуль
-- ============================================

CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_id UUID REFERENCES organizations(id),
  work_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'archived')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE estimate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  rate_id UUID REFERENCES rates(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Аудит (критические действия)
-- ============================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  changes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Триггер: пересчёт итога сметы
-- ============================================

CREATE OR REPLACE FUNCTION recalc_estimate_total() RETURNS TRIGGER AS $$
BEGIN
  UPDATE estimates SET
    total_amount = (
      SELECT COALESCE(SUM(total), 0)
      FROM estimate_items
      WHERE estimate_id = COALESCE(NEW.estimate_id, OLD.estimate_id)
    ),
    updated_at = now()
  WHERE id = COALESCE(NEW.estimate_id, OLD.estimate_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_estimate_recalc
  AFTER INSERT OR UPDATE OR DELETE ON estimate_items
  FOR EACH ROW EXECUTE FUNCTION recalc_estimate_total();

-- ============================================
-- Триггер: updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_material_catalog_updated_at BEFORE UPDATE ON material_catalog FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rates_updated_at BEFORE UPDATE ON rates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_estimates_updated_at BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_estimate_items_updated_at BEFORE UPDATE ON estimate_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Индексы
-- ============================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_projects_org_id ON projects(org_id);
CREATE INDEX idx_projects_code ON projects(code);
CREATE INDEX idx_estimates_project_id ON estimates(project_id);
CREATE INDEX idx_estimates_status ON estimates(status);
CREATE INDEX idx_estimate_items_estimate_id ON estimate_items(estimate_id);
CREATE INDEX idx_cost_types_category_id ON cost_types(category_id);
CREATE INDEX idx_rates_cost_type_id ON rates(cost_type_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
