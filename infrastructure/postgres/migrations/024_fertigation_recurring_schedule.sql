BEGIN;
ALTER TABLE spff.fertigation_recipes
  ADD COLUMN application_mode text NOT NULL DEFAULT 'once',
  ADD COLUMN application_interval_days integer;
ALTER TABLE spff.fertigation_recipes
  ADD CONSTRAINT fertigation_application_schedule_check CHECK (
    (application_mode = 'once' AND application_interval_days IS NULL)
    OR (application_mode = 'interval' AND application_interval_days IS NOT NULL
        AND application_interval_days BETWEEN 1 AND 1000)
  );
COMMENT ON COLUMN spff.fertigation_recipes.application_interval_days IS
  'Calendar-day interval from hst_from through hst_to inclusive. Existing programs stay once-only.';
COMMIT;
