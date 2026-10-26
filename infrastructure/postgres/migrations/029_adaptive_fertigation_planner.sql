BEGIN;
-- Server planner only. No actuator configuration, command or session is created.
CREATE TABLE spff.fertigation_planner_profiles (
  site_id text NOT NULL,
  device_id text NOT NULL,
  recipe_id uuid NOT NULL REFERENCES spff.fertigation_recipes(recipe_id),
  recipe_revision bigint NOT NULL CHECK (recipe_revision > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id,device_id,recipe_id),
  FOREIGN KEY (site_id,device_id) REFERENCES spff.devices(site_id,device_id)
);
CREATE TABLE spff.fertigation_planner_profile_revisions (
  site_id text NOT NULL, device_id text NOT NULL, recipe_id uuid NOT NULL,
  revision bigint NOT NULL, snapshot jsonb NOT NULL,
  changed_by text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id,device_id,recipe_id,revision),
  FOREIGN KEY (site_id,device_id,recipe_id)
    REFERENCES spff.fertigation_planner_profiles(site_id,device_id,recipe_id)
);
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.fertigation_planner_profiles TO %I',r);
      EXECUTE format('GRANT SELECT,INSERT ON spff.fertigation_planner_profile_revisions TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.fertigation_planner_profiles,spff.fertigation_planner_profile_revisions TO %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
