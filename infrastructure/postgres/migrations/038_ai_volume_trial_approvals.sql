BEGIN;
-- Source-only migration: DO NOT apply to running SPFF until authorized.
-- Audit of human approval of a SHADOW simulation proposal, not an actuation grant.
CREATE TABLE spff.ai_volume_trial_approvals (
  site_id text NOT NULL REFERENCES spff.sites(site_id),
  approval_id uuid NOT NULL,
  device_id text NOT NULL,
  approved_by text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  request_snapshot jsonb NOT NULL,
  approval_snapshot jsonb NOT NULL,
  source_recorded_at timestamptz NOT NULL,
  source_volume_l double precision NOT NULL CHECK (source_volume_l > 0),
  target_water_l double precision NOT NULL CHECK (target_water_l BETWEEN 1 AND 100),
  duration_sec integer NOT NULL CHECK (duration_sec BETWEEN 5 AND 60),
  command_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','queueing','queued')),
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > approved_at),
  queued_at timestamptz,
  PRIMARY KEY(site_id,approval_id),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE INDEX ai_volume_trial_approvals_recent
  ON spff.ai_volume_trial_approvals(site_id,approved_at DESC);
-- Intentionally NO FK to spff.control_commands; command may not exist.
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.ai_volume_trial_approvals TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.ai_volume_trial_approvals TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
