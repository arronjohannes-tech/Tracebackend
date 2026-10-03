-- Copernicus Data Space / Sentinel Hub "Process API" integration (POST /process/v1).
-- Stored separately from organization_api_config so the existing API/EU configuration stays untouched.
CREATE TABLE IF NOT EXISTS organization_copernicus_process_config (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  client_id_ciphertext text,
  client_secret_ciphertext text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS organization_copernicus_process_config_set_updated_at
  ON organization_copernicus_process_config;
CREATE TRIGGER organization_copernicus_process_config_set_updated_at
  BEFORE UPDATE ON organization_copernicus_process_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE organization_copernicus_process_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_copernicus_process_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_copernicus_process_config_tenant_policy
  ON organization_copernicus_process_config;
CREATE POLICY organization_copernicus_process_config_tenant_policy
  ON organization_copernicus_process_config
  USING (app_system_admin() OR organization_id = app_organization_id())
  WITH CHECK (app_system_admin() OR organization_id = app_organization_id());
