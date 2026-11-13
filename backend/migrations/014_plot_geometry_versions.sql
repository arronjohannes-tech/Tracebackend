-- Every geometry state of a plot as its own GeoJSON version. The version number equals plots.revision,
-- so it lines up with the optimistic locking used by the mobile sync.
CREATE TABLE IF NOT EXISTS plot_geometry_versions (
  organization_id uuid NOT NULL,
  plot_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  polygon geometry(Polygon, 4326) NOT NULL CHECK (ST_IsValid(polygon)),
  track_points jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(track_points) = 'array'),
  area_ha numeric(14,4) NOT NULL CHECK (area_ha > 0),
  source text NOT NULL CHECK (source IN ('mobile', 'tracehub')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, plot_id, version),
  FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id) ON DELETE CASCADE
);

ALTER TABLE plot_geometry_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plot_geometry_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plot_geometry_versions_tenant_policy ON plot_geometry_versions;
CREATE POLICY plot_geometry_versions_tenant_policy ON plot_geometry_versions
  USING (app_system_admin() OR organization_id = app_organization_id())
  WITH CHECK (app_system_admin() OR organization_id = app_organization_id());