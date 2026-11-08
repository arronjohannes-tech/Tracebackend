ALTER TABLE users ADD COLUMN assigned_roles user_role[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
UPDATE users SET assigned_roles = ARRAY[role];
ALTER TABLE users ADD CONSTRAINT users_assigned_roles_valid CHECK (
  cardinality(assigned_roles) BETWEEN 1 AND 5 AND role = ANY(assigned_roles)
  AND ((role = 'system_admin' AND assigned_roles = ARRAY['system_admin'::user_role])
    OR (role <> 'system_admin' AND NOT ('system_admin'::user_role = ANY(assigned_roles))))
);

CREATE FUNCTION maintain_assigned_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(NEW.assigned_roles) = 0 OR
     (TG_OP = 'UPDATE' AND NEW.role <> OLD.role AND NEW.assigned_roles = OLD.assigned_roles) THEN
    NEW.assigned_roles := ARRAY[NEW.role];
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_assigned_roles BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION maintain_assigned_roles();

CREATE TABLE role_permissions (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role NOT NULL CHECK (role <> 'system_admin'),
  section text NOT NULL CHECK (section IN ('overview','suppliers','plots','shipments','risk','dds','guide','users','roles')),
  can_read boolean NOT NULL,
  can_write boolean NOT NULL,
  PRIMARY KEY (organization_id, role, section),
  CHECK (NOT can_write OR can_read)
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_tenant ON role_permissions
  USING (current_setting('app.is_system_admin', true) = 'true'
    OR organization_id = NULLIF(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (current_setting('app.is_system_admin', true) = 'true'
    OR organization_id = NULLIF(current_setting('app.current_organization', true), '')::uuid);
