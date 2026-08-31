BEGIN;

CREATE TABLE IF NOT EXISTS spff.site_smart_soil_references (
  site_id text NOT NULL,
  zone_id text NOT NULL,
  crop_name text NOT NULL CHECK (char_length(btrim(crop_name)) BETWEEN 1 AND 100),
  temperature_min_c double precision NOT NULL,
  temperature_max_c double precision NOT NULL,
  soil_ph_min double precision NOT NULL,
  soil_ph_max double precision NOT NULL,
  humidity_min_percent double precision NOT NULL,
  humidity_max_percent double precision NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, zone_id),
  CONSTRAINT smart_soil_reference_site_fk
    FOREIGN KEY (site_id) REFERENCES spff.sites(site_id) ON DELETE CASCADE,
  CONSTRAINT smart_soil_reference_temperature_check
    CHECK (
      temperature_min_c BETWEEN -20 AND 80
      AND temperature_max_c BETWEEN -20 AND 80
      AND temperature_min_c <= temperature_max_c
    ),
  CONSTRAINT smart_soil_reference_ph_check
    CHECK (
      soil_ph_min BETWEEN 0 AND 14
      AND soil_ph_max BETWEEN 0 AND 14
      AND soil_ph_min <= soil_ph_max
    ),
  CONSTRAINT smart_soil_reference_humidity_check
    CHECK (
      humidity_min_percent BETWEEN 0 AND 100
      AND humidity_max_percent BETWEEN 0 AND 100
      AND humidity_min_percent <= humidity_max_percent
    )
);

DROP TRIGGER IF EXISTS site_smart_soil_references_updated_at
  ON spff.site_smart_soil_references;
CREATE TRIGGER site_smart_soil_references_updated_at
BEFORE UPDATE ON spff.site_smart_soil_references
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_api_role', 'spff_app']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON spff.site_smart_soil_references TO %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup_role') THEN
    GRANT SELECT ON spff.site_smart_soil_references TO spff_backup_role;
  END IF;
END;
$$;

COMMENT ON TABLE spff.site_smart_soil_references IS
  'Manual agronomy reference ranges used by Smart Soil for direct sensor comparison.';

COMMIT;
