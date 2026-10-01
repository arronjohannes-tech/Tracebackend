ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS trading_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS registration_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS street_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_contact_email_unique
  ON suppliers (organization_id, lower(contact_email)) WHERE contact_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_invitations_org_email_idx
  ON supplier_invitations (organization_id, lower(email));

ALTER TABLE supplier_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_invitations_tenant_policy ON supplier_invitations;
CREATE POLICY supplier_invitations_tenant_policy ON supplier_invitations
  USING (app_system_admin() OR organization_id = app_organization_id())
  WITH CHECK (app_system_admin() OR organization_id = app_organization_id());