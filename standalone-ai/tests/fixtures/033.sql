BEGIN;
CREATE TABLE spff.protocol_guide_edits (
 site_id text NOT NULL REFERENCES spff.sites(site_id), crop_id text NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(overrides)='object'),
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,crop_id)
);
CREATE TABLE spff.protocol_guide_revisions (
 site_id text NOT NULL, crop_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 source_sha256 text NOT NULL, changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='array'),
 overrides jsonb NOT NULL CHECK(jsonb_typeof(overrides)='object'), note text NOT NULL DEFAULT '',
 actor text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,crop_id,revision),
 FOREIGN KEY(site_id,crop_id) REFERENCES spff.protocol_guide_edits(site_id,crop_id)
);
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['spff_app','spff_api_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.protocol_guide_edits TO %I',r);
   EXECUTE format('GRANT SELECT,INSERT ON spff.protocol_guide_revisions TO %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['spff_backup','spff_backup_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON spff.protocol_guide_edits,spff.protocol_guide_revisions TO %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;

