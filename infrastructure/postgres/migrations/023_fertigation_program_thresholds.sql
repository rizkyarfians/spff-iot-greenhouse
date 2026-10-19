BEGIN;
ALTER TABLE spff.fertigation_recipes
 ADD COLUMN IF NOT EXISTS moisture_low_percent double precision,
 ADD COLUMN IF NOT EXISTS moisture_target_percent double precision,
 ADD COLUMN IF NOT EXISTS ec_low_us_cm double precision,
 ADD COLUMN IF NOT EXISTS ec_target_us_cm double precision,
 ADD COLUMN IF NOT EXISTS ec_high_us_cm double precision;
ALTER TABLE spff.fertigation_recipes
 ADD CONSTRAINT fertigation_program_moisture_order CHECK (
 (moisture_low_percent IS NULL AND moisture_target_percent IS NULL)
 OR (moisture_low_percent BETWEEN 0 AND 100 AND moisture_target_percent BETWEEN 0 AND 100
 AND moisture_low_percent < moisture_target_percent)),
 ADD CONSTRAINT fertigation_program_ec_order CHECK (
 (ec_low_us_cm IS NULL AND ec_target_us_cm IS NULL AND ec_high_us_cm IS NULL)
 OR (ec_low_us_cm >= 0 AND ec_low_us_cm < ec_target_us_cm
 AND ec_target_us_cm < ec_high_us_cm AND ec_high_us_cm <= 100000));
COMMENT ON COLUMN spff.fertigation_recipes.ec_low_us_cm IS
 'Agronomic EC from approved program. NULL means not configured; never invent defaults.';
COMMIT;