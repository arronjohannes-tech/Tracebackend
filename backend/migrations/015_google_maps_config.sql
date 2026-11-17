CREATE TABLE IF NOT EXISTS organization_google_maps_config (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  api_key_ciphertext text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR api_key_ciphertext IS NOT NULL)
);

DROP TRIGGER IF EXISTS organization_google_maps_config_set_updated_at ON organization_google_maps_config;
CREATE TRIGGER organization_google_maps_config_set_updated_at
  BEFORE UPDATE ON organization_google_maps_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE organization_google_maps_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_google_maps_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_google_maps_config_tenant_policy ON organization_google_maps_config;
CREATE POLICY organization_google_maps_config_tenant_policy
  ON organization_google_maps_config
  USING (app_system_admin() OR organization_id = app_organization_id())
  WITH CHECK (app_system_admin() OR organization_id = app_organization_id());
