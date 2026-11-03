BEGIN;

-- Device-scoped AI execution permission, independent of ESP32 Manual/Automatic.
-- No default LIVE row: missing records resolve to SHADOW in the API,
-- and Worker requires an explicit mode=live row before AI dispatch.
CREATE TABLE spff.ai_execution_modes (
  site_id text NOT NULL,
  device_id text NOT NULL,
  mode text NOT NULL DEFAULT 'shadow'
    CHECK (mode IN ('off','shadow','live')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id,device_id),
  FOREIGN KEY (site_id,device_id)
    REFERENCES spff.devices(site_id,device_id) ON DELETE RESTRICT
);

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.ai_execution_modes TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_worker','spff_worker_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.ai_execution_modes TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.ai_execution_modes TO %I',r);
    END IF;
  END LOOP;
END $$;

COMMIT;
