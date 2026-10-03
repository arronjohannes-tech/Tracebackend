CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference text NOT NULL CHECK (length(trim(reference)) BETWEEN 1 AND 80),
  product text NOT NULL DEFAULT '' CHECK (length(product) <= 200),
  hs_code text NOT NULL DEFAULT '0901' CHECK (length(hs_code) <= 20),
  quantity_kg numeric(14,3) NOT NULL CHECK (quantity_kg > 0),
  origin_country text NOT NULL DEFAULT '' CHECK (length(origin_country) <= 100),
  origin_region text NOT NULL DEFAULT '' CHECK (length(origin_region) <= 200),
  supplier_id uuid,
  destination text NOT NULL DEFAULT '' CHECK (length(destination) <= 200),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_transit', 'arrived', 'cancelled')),
  expected_arrival date,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(organization_id, id)
);
CREATE INDEX IF NOT EXISTS shipments_org_created_idx
  ON shipments (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS shipments_set_updated_at ON shipments;
CREATE TRIGGER shipments_set_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipments_tenant_policy ON shipments;
CREATE POLICY shipments_tenant_policy ON shipments
  USING (app_system_admin() OR organization_id = app_organization_id())
  WITH CHECK (app_system_admin() OR organization_id = app_organization_id());
