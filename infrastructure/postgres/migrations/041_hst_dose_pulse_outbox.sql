BEGIN;

CREATE TABLE IF NOT EXISTS spff.hst_dose_pulse_commands (
  site_id text NOT NULL,
  session_id uuid NOT NULL,
  command_id uuid PRIMARY KEY,
  cycle integer NOT NULL CHECK (cycle BETWEEN 1 AND 1000),
  operation text NOT NULL CHECK (operation IN ('pulse', 'stop', 'release')),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'accepted', 'completed', 'rejected', 'fault')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_published_at timestamptz,
  finished_at timestamptz,
  ack jsonb,
  UNIQUE (site_id, session_id, cycle, operation),
  FOREIGN KEY (site_id, session_id) REFERENCES spff.dose_volume_bindings(site_id, session_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS hst_dose_one_pending_pulse
  ON spff.hst_dose_pulse_commands(site_id, session_id)
  WHERE operation = 'pulse' AND status IN ('pending', 'published', 'accepted');

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'spff_app', 'spff_api_role', 'spff_mqtt_worker', 'spff_mqtt_role', 'spff_worker', 'spff_worker_role'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON spff.hst_dose_pulse_commands TO %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
