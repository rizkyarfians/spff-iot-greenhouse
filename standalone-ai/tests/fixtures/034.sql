BEGIN;
CREATE TABLE spff.guide_programs (
 site_id text NOT NULL REFERENCES spff.sites(site_id), program_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), config jsonb NOT NULL,
 source_sha256 text NOT NULL, guide_revision bigint NOT NULL,
 sheet_snapshot jsonb NOT NULL, plan jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
 PRIMARY KEY(site_id,program_id)
);
CREATE TABLE spff.guide_program_revisions (
 site_id text NOT NULL, program_id uuid NOT NULL, revision integer NOT NULL,
 config jsonb NOT NULL, source_sha256 text NOT NULL, guide_revision bigint NOT NULL,
 sheet_snapshot jsonb NOT NULL, plan jsonb NOT NULL, actor text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,program_id,revision), FOREIGN KEY(site_id,program_id) REFERENCES spff.guide_programs(site_id,program_id)
);
CREATE TABLE spff.guide_program_completions (
 site_id text NOT NULL, program_id uuid NOT NULL, activity_id text NOT NULL, activity_fingerprint text NOT NULL,
 program_revision integer NOT NULL, activity_snapshot jsonb NOT NULL,
 actor text NOT NULL, note text NOT NULL DEFAULT '', completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,program_id,activity_fingerprint),
 FOREIGN KEY(site_id,program_id,program_revision) REFERENCES spff.guide_program_revisions(site_id,program_id,revision)
);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.guide_programs TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT ON spff.guide_program_revisions,spff.guide_program_completions TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON spff.guide_programs,spff.guide_program_revisions,spff.guide_program_completions TO %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;

