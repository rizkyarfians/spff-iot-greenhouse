BEGIN;
-- Durable, shared local authority for HST SHADOW ON/OFF. Safe default ON.
CREATE TABLE spff.hst_execution_modes (
 site_id text PRIMARY KEY REFERENCES spff.sites(site_id),
 shadow_enabled boolean NOT NULL DEFAULT true,
 changed_by text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO spff.hst_execution_modes(site_id,shadow_enabled,changed_by)
 SELECT site_id,true,'system-default' FROM spff.sites
 ON CONFLICT(site_id) DO NOTHING;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.hst_execution_modes TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON spff.hst_execution_modes TO %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
