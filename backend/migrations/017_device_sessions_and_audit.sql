CREATE TABLE device_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web', 'unknown')),
  app_version varchar(80) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  idle_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  ended_at timestamptz,
  end_reason text
);
CREATE INDEX device_sessions_tenant_idx ON device_sessions(organization_id, created_at DESC);
CREATE INDEX device_sessions_retention_idx ON device_sessions(created_at);
CREATE TABLE device_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  action varchar(120) NOT NULL,
  method varchar(10),
  path varchar(300),
  status_code integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_events_session_idx ON device_events(session_id, created_at DESC);
CREATE INDEX device_events_time_idx ON device_events(created_at);
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY device_sessions_tenant ON device_sessions
  USING (current_setting('app.is_system_admin', true) = 'true'
    OR organization_id = NULLIF(current_setting('app.current_organization', true), '')::uuid);
ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_events FORCE ROW LEVEL SECURITY;
CREATE POLICY device_events_tenant ON device_events
  USING (EXISTS (SELECT 1 FROM device_sessions s WHERE s.id = session_id));

CREATE FUNCTION revoke_changed_user_device_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_version IS DISTINCT FROM OLD.token_version OR NOT NEW.active THEN
    WITH revoked AS (
      UPDATE device_sessions SET ended_at=now(),end_reason='revoked'
      WHERE user_id=NEW.id AND ended_at IS NULL RETURNING id
    ) INSERT INTO device_events(session_id,action,status_code)
      SELECT id,'session.revoked',200 FROM revoked;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_revoke_device_sessions AFTER UPDATE OF token_version,active ON users
  FOR EACH ROW EXECUTE FUNCTION revoke_changed_user_device_sessions();
