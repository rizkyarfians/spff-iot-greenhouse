BEGIN;
CREATE TABLE spff.device_soil_ec_execution_configs (
  site_id text NOT NULL,
  device_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 2147483647),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  PRIMARY KEY (site_id,device_id),
  FOREIGN KEY (site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
-- Opt in explicitly, including installations that previously enabled the env flag.
INSERT INTO spff.device_soil_ec_execution_configs(site_id,device_id,updated_by)
  SELECT site_id,device_id,'migration-030-default-off' FROM spff.devices;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.device_soil_ec_execution_configs TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_worker','spff_worker_role','spff_backup','spff_backup_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.device_soil_ec_execution_configs TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
