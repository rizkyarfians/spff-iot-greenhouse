BEGIN;
CREATE TABLE spff.guide_ec_profiles (
 site_id text NOT NULL REFERENCES spff.sites(site_id), recipe_key text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), profile jsonb NOT NULL,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,recipe_key)
);
CREATE TABLE spff.guide_ec_profile_revisions (
 site_id text NOT NULL,recipe_key text NOT NULL,revision integer NOT NULL,profile jsonb NOT NULL,
 actor text NOT NULL,saved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(site_id,recipe_key,revision),
 FOREIGN KEY(site_id,recipe_key) REFERENCES spff.guide_ec_profiles(site_id,recipe_key)
);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.guide_ec_profiles TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT ON spff.guide_ec_profile_revisions TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON spff.guide_ec_profiles,spff.guide_ec_profile_revisions TO %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
