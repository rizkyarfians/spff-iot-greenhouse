BEGIN;
ALTER TABLE spff.device_automatic_control_configs
  ADD COLUMN IF NOT EXISTS operator_override_active boolean NOT NULL DEFAULT false;
ALTER TABLE spff.device_automatic_control_configs
  ADD COLUMN IF NOT EXISTS operator_override_command_id text;
ALTER TABLE spff.device_automatic_control_configs
  ADD COLUMN IF NOT EXISTS operator_override_started_at timestamptz;
COMMIT;
