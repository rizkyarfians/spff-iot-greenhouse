BEGIN;

CREATE TABLE IF NOT EXISTS spff.site_crop_selections (
  site_id text NOT NULL,
  zone_id text NOT NULL,
  crop_id text NOT NULL CHECK (crop_id IN (
    'sweet-potato', 'pak-choi', 'mustard-greens', 'amaranth',
    'water-spinach', 'tomato', 'chili-pepper', 'cucumber',
    'eggplant', 'lettuce'
  )),
  selected_by text NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, zone_id),
  CONSTRAINT site_crop_selection_site_fk
    FOREIGN KEY (site_id) REFERENCES spff.sites(site_id) ON DELETE CASCADE
);

INSERT INTO spff.site_crop_selections (
  site_id,
  zone_id,
  crop_id,
  selected_by
)
SELECT
  site_id,
  'soil-1',
  'sweet-potato',
  'migration-011'
FROM spff.sites
ON CONFLICT (site_id, zone_id) DO NOTHING;

DROP TRIGGER IF EXISTS site_crop_selections_updated_at
  ON spff.site_crop_selections;
CREATE TRIGGER site_crop_selections_updated_at
BEFORE UPDATE ON spff.site_crop_selections
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_api_role', 'spff_app']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON spff.site_crop_selections TO %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup_role') THEN
    GRANT SELECT ON spff.site_crop_selections TO spff_backup_role;
  END IF;
END;
$$;

COMMENT ON TABLE spff.site_crop_selections IS
  'Selected monitoring and crop-recommendation profile per site and soil zone.';

COMMIT;
