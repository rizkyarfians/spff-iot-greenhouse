BEGIN;
ALTER TABLE spff.fertigation_recipes
  ADD COLUMN IF NOT EXISTS planting_date date,
  ADD COLUMN IF NOT EXISTS application_date date,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS spff.fertigation_recipe_revisions (
  recipe_id uuid NOT NULL REFERENCES spff.fertigation_recipes(recipe_id),
  revision integer NOT NULL CHECK (revision >= 1),
  snapshot jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(recipe_id, revision)
);
CREATE TABLE IF NOT EXISTS spff.fertigation_evaluations (
  evaluation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  recipe_id uuid NOT NULL REFERENCES spff.fertigation_recipes(recipe_id),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  telemetry_recorded_at timestamptz,
  device_recorded_at timestamptz,
  decision jsonb NOT NULL,
  requested_by text NOT NULL,
  CONSTRAINT evaluation_device_fk FOREIGN KEY (site_id,device_id)
    REFERENCES spff.devices(site_id,device_id)
);
CREATE INDEX IF NOT EXISTS fertigation_evaluations_recent_idx
  ON spff.fertigation_evaluations(site_id,device_id,evaluated_at DESC);
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_api_role','spff_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON spff.fertigation_recipes TO %I', role_name);
      EXECUTE format('GRANT SELECT,INSERT ON spff.fertigation_recipe_revisions,spff.fertigation_evaluations TO %I', role_name);
      EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE spff.fertigation_evaluations_evaluation_id_seq TO %I',role_name);
    END IF;
  END LOOP;
END $$;
COMMIT;