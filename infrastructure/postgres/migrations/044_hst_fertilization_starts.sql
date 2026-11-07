BEGIN;
CREATE TABLE IF NOT EXISTS spff.hst_fertilization_starts (
  start_id uuid PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  program_id uuid NOT NULL,
  activity_id text NOT NULL,
  hst integer NOT NULL,
  application_day date NOT NULL,
  product text NOT NULL,
  method text NOT NULL,
  water_command_id text NOT NULL REFERENCES spff.control_commands(command_id),
  fertilizer_command_id text NOT NULL REFERENCES spff.control_commands(command_id),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','started','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  UNIQUE(site_id,device_id,application_day),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role','spff_worker','spff_worker_role','spff_mqtt_worker','spff_mqtt_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.hst_fertilization_starts TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
