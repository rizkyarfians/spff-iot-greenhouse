DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_app', 'spff_api_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT UPDATE (enabled) ON spff.sensor_definitions TO %I', role_name);
    END IF;
  END LOOP;
END $$;
