CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_token_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_active_idx
  ON password_reset_tokens (user_id, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY password_reset_tokens_system_only ON password_reset_tokens
  USING (current_setting('app.is_system_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_system_admin', true) = 'true');
