BEGIN;
CREATE TABLE IF NOT EXISTS spff.ec_dose_profiles (
  site_id text NOT NULL,device_id text NOT NULL,product_key text NOT NULL,
  product text NOT NULL,coefficient double precision NOT NULL CHECK(coefficient>0 AND coefficient<=10000000),
  validated boolean NOT NULL DEFAULT false,calibration_reference text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id,device_id,product_key),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id),
  CHECK(NOT validated OR length(calibration_reference)>0)
);
CREATE TABLE IF NOT EXISTS spff.ec_dose_estimates (
  phase_id uuid PRIMARY KEY REFERENCES spff.hst_fertilization_phases(phase_id),
  profile_snapshot jsonb NOT NULL,completion_profile_snapshot jsonb,baseline_ec double precision NOT NULL CHECK(baseline_ec>=0),
  baseline_at timestamptz NOT NULL,baseline_boot_id text NOT NULL,
  cursor_id bigint NOT NULL DEFAULT 0,anchor jsonb,
  estimated_g double precision NOT NULL DEFAULT 0 CHECK(estimated_g>=0 AND estimated_g<'Infinity'::float8),
  unmeasured_intervals integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT 'awaiting_samples',updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spff.ec_dose_intervals (
  phase_id uuid NOT NULL REFERENCES spff.ec_dose_estimates(phase_id),telemetry_id bigint NOT NULL,
  recorded_at timestamptz NOT NULL,status text NOT NULL CHECK(status IN ('measured','anchor','excluded','invalid')),
  reason text NOT NULL,previous_at timestamptz,ec_us_cm double precision,volume_l double precision,mass_g double precision,
  PRIMARY KEY(phase_id,telemetry_id)
);
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role','spff_worker','spff_worker_role','spff_mqtt_worker','spff_mqtt_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.ec_dose_profiles,spff.ec_dose_estimates,spff.ec_dose_intervals TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
