BEGIN;

ALTER TABLE spff.telemetry_samples
  ADD COLUMN IF NOT EXISTS sensor_health jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'spff.telemetry_samples'::regclass
      AND conname = 'telemetry_sensor_health_object_check'
  ) THEN
    ALTER TABLE spff.telemetry_samples
      ADD CONSTRAINT telemetry_sensor_health_object_check
      CHECK (jsonb_typeof(sensor_health) = 'object');
  END IF;
END;
$$;

UPDATE spff.telemetry_samples
SET sensor_health = raw_payload->'sensorHealth'
WHERE sensor_health = '{}'::jsonb
  AND jsonb_typeof(raw_payload->'sensorHealth') = 'object';

COMMENT ON COLUMN spff.telemetry_samples.sensor_health IS
  'Validity and optional fault reason keyed by canonical telemetry sensor key.';

COMMIT;
