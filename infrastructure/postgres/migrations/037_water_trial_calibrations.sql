BEGIN;
-- Calibration evidence only. Does not modify a firmware meter factor or operational recipe.
CREATE TABLE spff.water_trial_calibrations (
  site_id text NOT NULL,
  command_id text NOT NULL,
  device_id text NOT NULL,
  meter_reported_l double precision NOT NULL CHECK(meter_reported_l > 0 AND meter_reported_l <= 10000),
  physical_measured_l double precision NOT NULL CHECK(physical_measured_l > 0 AND physical_measured_l <= 10000),
  provisional_correction_factor double precision NOT NULL
    CHECK(provisional_correction_factor > 0 AND provisional_correction_factor < 100),
  evidence_ack jsonb NOT NULL,
  operator_note text NOT NULL DEFAULT '',
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id,command_id),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id),
  FOREIGN KEY(command_id) REFERENCES spff.control_commands(command_id)
);
CREATE INDEX water_trial_calibrations_by_device
  ON spff.water_trial_calibrations(site_id,device_id,recorded_at DESC);
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT ON spff.water_trial_calibrations TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.water_trial_calibrations TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
