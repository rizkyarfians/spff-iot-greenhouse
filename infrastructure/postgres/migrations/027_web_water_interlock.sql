BEGIN;
CREATE TABLE spff.device_water_interlock_configs (
  site_id text NOT NULL, device_id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483647),
  enabled boolean NOT NULL DEFAULT true,
  acknowledged_revision integer, acknowledgement_status text CHECK(acknowledgement_status IN ('applied','rejected')),
  applied_enabled boolean, acknowledged_at timestamptz, acknowledgement_reason text,
  published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  PRIMARY KEY(site_id,device_id),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
INSERT INTO spff.device_water_interlock_configs(site_id,device_id,updated_by)
  SELECT site_id,device_id,'migration-027-default-enabled' FROM spff.devices;
CREATE TABLE spff.water_interlock_ack_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL, device_id text NOT NULL, revision integer NOT NULL,
  status text NOT NULL CHECK(status IN ('applied','rejected')), payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id),
  UNIQUE(site_id,device_id,revision,status)
);
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.device_water_interlock_configs TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_worker','spff_worker_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,UPDATE ON spff.device_water_interlock_configs TO %I',r);
      EXECUTE format('GRANT SELECT,INSERT ON spff.water_interlock_ack_events TO %I',r);
      EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE spff.water_interlock_ack_events_id_seq TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.device_water_interlock_configs,spff.water_interlock_ack_events TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
