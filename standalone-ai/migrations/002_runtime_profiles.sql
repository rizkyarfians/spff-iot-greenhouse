-- AI-owned configuration only; no SPFF operational table is altered.
BEGIN;
CREATE TABLE IF NOT EXISTS spff_ai.runtime_profiles (
 scope text PRIMARY KEY,
 version text NOT NULL,
 profile jsonb NOT NULL CHECK(jsonb_typeof(profile)='object'),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spff_ai.runtime_profile_history (
 scope text NOT NULL,
 version text NOT NULL,
 profile jsonb NOT NULL,
 updated_by text NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(scope,version)
);
COMMIT;
