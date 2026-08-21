BEGIN;

CREATE TABLE IF NOT EXISTS spff.app_users (
  user_id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,

  role text NOT NULL
    CHECK (role IN ('admin', 'operator')),

  enabled boolean NOT NULL DEFAULT true,

  failed_login_count integer NOT NULL DEFAULT 0
    CHECK (failed_login_count >= 0),

  locked_until timestamptz,
  last_login_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_users_username_format CHECK (
    username = lower(username)
    AND username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
  )
);

CREATE INDEX IF NOT EXISTS app_users_role_enabled_idx
  ON spff.app_users (role, enabled);


CREATE TABLE IF NOT EXISTS spff.auth_sessions (
  session_id text PRIMARY KEY,

  user_id text NOT NULL,

  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  revoked_at timestamptz,

  ip_address inet,
  user_agent text,

  CONSTRAINT auth_sessions_user_fk
    FOREIGN KEY (user_id)
    REFERENCES spff.app_users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT auth_sessions_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_active_token_idx
  ON spff.auth_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON spff.auth_sessions (user_id, created_at DESC);


CREATE TABLE IF NOT EXISTS spff.audit_logs (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  user_id text,
  username text NOT NULL,
  role text,

  action text NOT NULL,

  resource_type text NOT NULL,
  resource_id text,

  success boolean NOT NULL,

  http_method text,
  http_path text,
  http_status integer,

  ip_address inet,
  user_agent text,

  metadata jsonb,

  occurred_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_user_fk
    FOREIGN KEY (user_id)
    REFERENCES spff.app_users(user_id)
    ON DELETE SET NULL,

  CONSTRAINT audit_logs_role_check
    CHECK (
      role IS NULL
      OR role IN ('admin', 'operator')
    )
);

CREATE INDEX IF NOT EXISTS audit_logs_occurred_idx
  ON spff.audit_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_user_occurred_idx
  ON spff.audit_logs (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_action_occurred_idx
  ON spff.audit_logs (action, occurred_at DESC);


DROP TRIGGER IF EXISTS app_users_set_updated_at
  ON spff.app_users;

CREATE TRIGGER app_users_set_updated_at
BEFORE UPDATE ON spff.app_users
FOR EACH ROW
EXECUTE FUNCTION spff.set_updated_at();


INSERT INTO spff.schema_migrations (
  version,
  name
)
VALUES (
  4,
  '004_local_auth_rbac'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;