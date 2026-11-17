ALTER TABLE organization_api_config
  ADD COLUMN IF NOT EXISTS satellite_comparison_enabled boolean NOT NULL DEFAULT false;
