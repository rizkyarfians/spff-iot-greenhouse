BEGIN;
ALTER TABLE spff.fertigation_recipes
  DROP CONSTRAINT fertigation_application_schedule_check,
  ADD COLUMN trigger_sample_count integer NOT NULL DEFAULT 3
    CHECK (trigger_sample_count BETWEEN 1 AND 20);
ALTER TABLE spff.fertigation_recipes
  ADD CONSTRAINT fertigation_application_schedule_check CHECK (
    (application_mode IN ('once', 'sensor') AND application_interval_days IS NULL)
    OR (application_mode = 'interval' AND application_interval_days IS NOT NULL
        AND application_interval_days BETWEEN 1 AND 1000)
  );
COMMENT ON COLUMN spff.fertigation_recipes.trigger_sample_count IS
  'Consecutive distinct fresh telemetry samples at/below agronomic trigger for sensor-driven advice.';
-- Existing programs keep their schedules and approval. Saving through the updated form
-- explicitly converts to sensor mode and resets approval through the normal API.
COMMIT;
