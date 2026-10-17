BEGIN;
ALTER TABLE spff.device_automatic_control_configs
  DROP CONSTRAINT IF EXISTS automatic_control_mode_ready_check;
-- Explicitly disable the previous sensor-driven controllers. Do not activate
-- any schedules or change the selected mode during deployment.
UPDATE spff.device_automatic_control_configs
SET water_enabled = false, fertilizer_enabled = false,
    revision = revision + 1, updated_at = now()
WHERE water_enabled OR fertilizer_enabled;
ALTER TABLE spff.device_automatic_control_configs
  ADD CONSTRAINT automatic_control_mode_ready_check
  CHECK (NOT water_enabled AND NOT fertilizer_enabled);
COMMIT;
