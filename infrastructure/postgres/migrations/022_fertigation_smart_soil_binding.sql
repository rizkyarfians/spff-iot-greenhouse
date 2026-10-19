BEGIN;
ALTER TABLE spff.fertigation_recipes
 ADD COLUMN IF NOT EXISTS zone_id text NOT NULL DEFAULT 'soil-1',
 ADD COLUMN IF NOT EXISTS crop_id text;
-- Historical recipes remain unbound, hence cannot be approved for live suggestions.
ALTER TABLE spff.fertigation_recipes
 ADD CONSTRAINT fertigation_recipe_crop_id_check
 CHECK (crop_id IS NULL OR crop_id IN ('sweet-potato','pak-choi','mustard-greens','amaranth','water-spinach','tomato','chili-pepper','cucumber','eggplant','lettuce'));
CREATE INDEX IF NOT EXISTS fertigation_recipe_crop_zone_idx
 ON spff.fertigation_recipes(site_id,zone_id,crop_id);
COMMENT ON COLUMN spff.fertigation_recipes.crop_id IS 'Explicit Smart Soil crop binding. NULL is deliberately not inferred from free-text name.';
COMMIT;