BEGIN;
ALTER TABLE spff.device_automatic_control_configs
  DROP CONSTRAINT IF EXISTS automatic_control_mode_ready_check;
-- Preserve all profiles, thresholds, enabled flags and selected modes.
-- NOT VALID also allows recovery if the abandoned schedule-only draft was
-- already applied. New/updated configurations must contain an enabled profile.
ALTER TABLE spff.device_automatic_control_configs
  ADD CONSTRAINT automatic_control_mode_ready_check
  CHECK (desired_mode <> 'automatic' OR water_enabled OR fertilizer_enabled) NOT VALID;
COMMIT;
