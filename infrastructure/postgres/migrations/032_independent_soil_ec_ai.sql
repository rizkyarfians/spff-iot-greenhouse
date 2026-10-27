BEGIN;
CREATE TABLE spff.soil_ec_automatic_profiles (
 site_id text NOT NULL, device_id text NOT NULL, recipe_id uuid NOT NULL REFERENCES spff.fertigation_recipes(recipe_id),
 recipe_revision bigint NOT NULL, profile jsonb NOT NULL, armed boolean NOT NULL DEFAULT true,
 reason text NOT NULL DEFAULT 'waiting_evaluation', updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,device_id),
 FOREIGN KEY(site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
-- Multiple sensor-triggered sessions per day share the existing daily ON budget.
DO $$ DECLARE constraint_name text; BEGIN
 SELECT conname INTO constraint_name FROM pg_constraint
 WHERE conrelid='spff.soil_ec_pulse_sessions'::regclass AND contype='u' AND array_length(conkey,1)=4;
 IF constraint_name IS NOT NULL THEN
  EXECUTE format('ALTER TABLE spff.soil_ec_pulse_sessions DROP CONSTRAINT %I',constraint_name);
 END IF;
END $$;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.soil_ec_automatic_profiles TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON spff.soil_ec_automatic_profiles TO %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
