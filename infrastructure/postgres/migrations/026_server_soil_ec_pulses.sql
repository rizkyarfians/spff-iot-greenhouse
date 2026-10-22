BEGIN;
-- Separate from volume-based session evidence: no inferred litres or grams.
CREATE TABLE spff.soil_ec_pulse_sessions (
  session_id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
  site_id text NOT NULL, device_id text NOT NULL, recipe_id uuid NOT NULL,
  application_day date NOT NULL, recipe_revision bigint NOT NULL,
  profile jsonb NOT NULL, rule_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('waiting','in_flight','completed','fault','cancelled')),
  reason text NOT NULL DEFAULT 'waiting_new_samples',
  cycles integer NOT NULL DEFAULT 0 CHECK(cycles>=0), total_on_ms bigint NOT NULL DEFAULT 0 CHECK(total_on_ms>=0),
  previous_ec double precision, no_response_cycles integer NOT NULL DEFAULT 0,
  settle_until timestamptz NOT NULL DEFAULT now(), started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), requested_by text NOT NULL,
  UNIQUE(site_id,device_id,recipe_id,application_day),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id),
  FOREIGN KEY(recipe_id) REFERENCES spff.fertigation_recipes(recipe_id)
);
-- Faults retain ownership until an operator cancels after investigating.
CREATE UNIQUE INDEX soil_ec_pulse_device_owner ON spff.soil_ec_pulse_sessions(site_id,device_id)
  WHERE status IN ('waiting','in_flight','fault');
CREATE TABLE spff.soil_ec_pulse_commands (
  command_id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES spff.soil_ec_pulse_sessions(session_id),
  cycle integer NOT NULL, operation text NOT NULL CHECK(operation IN ('pulse','stop','release')),
  payload jsonb NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','accepted','completed','rejected','fault')),
  created_at timestamptz NOT NULL DEFAULT now(), last_published_at timestamptz,
  finished_at timestamptz, ack jsonb, UNIQUE(session_id,cycle,operation)
);
CREATE UNIQUE INDEX soil_ec_one_pulse ON spff.soil_ec_pulse_commands(session_id)
  WHERE operation='pulse' AND status IN ('pending','published','accepted');
CREATE TABLE spff.soil_ec_pulse_ack_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, command_id uuid NOT NULL REFERENCES spff.soil_ec_pulse_commands(command_id),
  received_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL, status text NOT NULL,
  UNIQUE(command_id,status)
);
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.soil_ec_pulse_sessions,spff.soil_ec_pulse_commands TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_worker','spff_worker_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,UPDATE ON spff.soil_ec_pulse_sessions,spff.soil_ec_pulse_commands TO %I',r);
      EXECUTE format('GRANT SELECT,INSERT ON spff.soil_ec_pulse_ack_events TO %I',r);
      EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE spff.soil_ec_pulse_ack_events_id_seq TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.soil_ec_pulse_sessions,spff.soil_ec_pulse_commands,spff.soil_ec_pulse_ack_events TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
