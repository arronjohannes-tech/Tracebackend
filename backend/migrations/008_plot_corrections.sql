-- Correction requests raised by reviewers for a single plot, a group of plots (supplier or producer) or all plots.
CREATE TABLE IF NOT EXISTS plot_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('plot', 'group', 'all')),
  group_type text CHECK (group_type IN ('supplier', 'producer')),
  group_key text CHECK (length(group_key) <= 200),
  group_label text NOT NULL DEFAULT '' CHECK (length(group_label) <= 200),
  category text NOT NULL
    CHECK (category IN ('geometry', 'area', 'geofence', 'duplicate', 'evidence', 'other')),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_note text NOT NULL DEFAULT '' CHECK (length(resolution_note) <= 2000),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK ((scope = 'group') = (group_type IS NOT NULL AND group_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS plot_correction_requests_org_created_idx
  ON plot_correction_requests (organization_id, created_at DESC);

-- One row per plot affected by a request; plot_revision remembers the version that was criticised.
CREATE TABLE IF NOT EXISTS plot_correction_items (
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL,
  plot_id uuid NOT NULL,
  plot_revision integer NOT NULL CHECK (plot_revision > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  resolved_at timestamptz,
  PRIMARY KEY (request_id, plot_id),
  FOREIGN KEY (organization_id, request_id)
    REFERENCES plot_correction_requests (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, plot_id)
    REFERENCES plots (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS plot_correction_items_plot_idx
  ON plot_correction_items (organization_id, plot_id, status);

DROP TRIGGER IF EXISTS plot_correction_requests_set_updated_at ON plot_correction_requests;
CREATE TRIGGER plot_correction_requests_set_updated_at
  BEFORE UPDATE ON plot_correction_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['plot_correction_requests', 'plot_correction_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_policy ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant_policy ON %I USING (app_system_admin() OR organization_id = app_organization_id()) WITH CHECK (app_system_admin() OR organization_id = app_organization_id())',
      table_name, table_name
    );
  END LOOP;
END $$;
