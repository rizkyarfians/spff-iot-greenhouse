-- Additive, AI-owned archive for SOURCE-SHADOW decisions.
-- Apply manually after backup and review. No operational spff tables are touched.
-- This migration neither deletes nor rewrites spff_ai.engine_state or audit_events.
BEGIN;
CREATE TABLE spff_ai.shadow_decisions (
  scope text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  decision_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, fingerprint),
  UNIQUE (scope, decision_id)
);
CREATE INDEX shadow_decisions_recent
  ON spff_ai.shadow_decisions(scope, observed_at DESC, decision_id DESC);
-- The runtime AI role must receive SELECT/INSERT on this table, using
-- the same least-privilege role that currently accesses spff_ai.engine_state.
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_ai', 'spff_ai_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT,INSERT ON spff_ai.shadow_decisions TO %I', r);
    END IF;
  END LOOP;
END $$;
COMMIT;
