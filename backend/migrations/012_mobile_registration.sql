CREATE TABLE mobile_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  phone_country text NOT NULL CHECK (phone_country ~ '^[A-Z]{2}$'),
  phone_number text NOT NULL CHECK (phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'active', 'disabled')),
  organization_id uuid REFERENCES organizations(id),
  assigned_roles user_role[],
  user_id uuid UNIQUE REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  activated_at timestamptz,
  activation_token_hash text UNIQUE,
  activation_expires_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'not_sent' CHECK (delivery_status IN ('not_sent', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved', 'active') OR (
    organization_id IS NOT NULL AND cardinality(assigned_roles) > 0
    AND NOT ('system_admin' = ANY(assigned_roles)))),
  CHECK (status <> 'active' OR user_id IS NOT NULL)
);
CREATE INDEX mobile_registrations_created_idx ON mobile_registrations (created_at DESC, id);
ALTER TABLE mobile_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_registrations_system_only ON mobile_registrations
  USING (current_setting('app.is_system_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_system_admin', true) = 'true');

ALTER TABLE users ADD COLUMN phone_country text;
ALTER TABLE users ADD COLUMN phone_number text;
