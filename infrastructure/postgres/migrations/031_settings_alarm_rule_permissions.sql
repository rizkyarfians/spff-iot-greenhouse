BEGIN;
-- site_settings writes invoke sync_environment_alarm_rules(), which runs as
-- the caller. Migration 012 granted API roles SELECT but omitted these writes.
-- Do not grant worker write access or change the trigger to SECURITY DEFINER.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('GRANT INSERT,UPDATE ON spff.alarm_rules TO %I',role_name);
    END IF;
  END LOOP;
END $$;
COMMIT;
