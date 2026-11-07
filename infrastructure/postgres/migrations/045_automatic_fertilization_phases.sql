BEGIN;
CREATE TABLE IF NOT EXISTS spff.hst_fertilization_phases (
  phase_id uuid PRIMARY KEY,
  site_id text NOT NULL, device_id text NOT NULL, program_id uuid NOT NULL,
  activity_id text NOT NULL, phase_number integer NOT NULL, title text NOT NULL,
  hst integer NOT NULL, product text NOT NULL, method text NOT NULL,
  target_g double precision CHECK(target_g >= 0 AND target_g < 'Infinity'::float8),
  delivered_g double precision CHECK(delivered_g >= 0 AND delivered_g < 'Infinity'::float8),
  formula_status text NOT NULL DEFAULT 'pending' CHECK(formula_status IN ('pending','ready')),
  fulfilled boolean NOT NULL DEFAULT false,
  baseline jsonb, started_at timestamptz, fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,program_id,activity_id),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id),
  FOREIGN KEY(site_id,program_id) REFERENCES spff.guide_programs(site_id,program_id)
);
ALTER TABLE spff.hst_fertilization_starts ADD COLUMN IF NOT EXISTS phase_id uuid
  REFERENCES spff.hst_fertilization_phases(phase_id);
ALTER TABLE spff.hst_fertilization_starts DROP CONSTRAINT IF EXISTS hst_fertilization_starts_site_id_device_id_application_day_key;
CREATE UNIQUE INDEX IF NOT EXISTS hst_start_once_per_phase ON spff.hst_fertilization_starts(phase_id) WHERE phase_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS spff.automatic_cycle_states (
  site_id text NOT NULL,device_id text NOT NULL,phase_id uuid REFERENCES spff.hst_fertilization_phases(phase_id),
  mode text NOT NULL CHECK(mode IN ('fertilization','waiting_off','watering','unavailable')),
  reason text NOT NULL, dispatch_enabled boolean NOT NULL DEFAULT false, next_hst integer, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id,device_id), FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE TABLE IF NOT EXISTS spff.fuzzy_water_runs (
  run_id uuid PRIMARY KEY,site_id text NOT NULL,device_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','stopping','completed')),
  input_at timestamptz NOT NULL,baseline_l double precision NOT NULL,boot_id text NOT NULL,
  target_l double precision NOT NULL CHECK(target_l > 0 AND target_l < 'Infinity'::float8),
  start_command_id text NOT NULL REFERENCES spff.control_commands(command_id),
  reason text,created_at timestamptz NOT NULL DEFAULT now(),stopped_at timestamptz,
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fuzzy_one_water_run ON spff.fuzzy_water_runs(site_id,device_id)
  WHERE status <> 'completed';
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role','spff_worker','spff_worker_role','spff_mqtt_worker','spff_mqtt_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.hst_fertilization_phases,spff.automatic_cycle_states,spff.fuzzy_water_runs TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
