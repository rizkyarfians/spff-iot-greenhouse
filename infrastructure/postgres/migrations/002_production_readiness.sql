BEGIN;

CREATE TABLE spff.actuator_schedules (
  schedule_id text PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  actuator_key text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  on_time time NOT NULL,
  off_time time NOT NULL,
  repeat_rule text NOT NULL
    CHECK (repeat_rule IN ('daily', 'weekdays', 'weekends', 'once')),
  run_date date,
  enabled boolean NOT NULL DEFAULT true,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT actuator_schedules_actuator_fk
    FOREIGN KEY (site_id, device_id, actuator_key)
    REFERENCES spff.actuators(site_id, device_id, actuator_key) ON DELETE RESTRICT,
  CONSTRAINT actuator_schedules_time_check CHECK (off_time > on_time),
  CONSTRAINT actuator_schedules_once_check CHECK (
    (repeat_rule = 'once' AND run_date IS NOT NULL)
    OR (repeat_rule <> 'once' AND run_date IS NULL)
  )
);

CREATE INDEX actuator_schedules_active_idx
  ON spff.actuator_schedules (site_id, enabled, actuator_key)
  WHERE enabled = true;

CREATE TRIGGER actuator_schedules_set_updated_at
BEFORE UPDATE ON spff.actuator_schedules
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

CREATE TABLE spff.schedule_executions (
  schedule_execution_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('on', 'off')),
  scheduled_for timestamptz NOT NULL,
  command_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_execution_schedule_fk
    FOREIGN KEY (schedule_id) REFERENCES spff.actuator_schedules(schedule_id) ON DELETE RESTRICT,
  CONSTRAINT schedule_execution_command_fk
    FOREIGN KEY (command_id) REFERENCES spff.control_commands(command_id) ON DELETE RESTRICT,
  CONSTRAINT schedule_execution_unique UNIQUE (schedule_id, action, scheduled_for)
);

CREATE INDEX schedule_executions_recent_idx
  ON spff.schedule_executions (scheduled_for DESC);

CREATE TABLE spff.site_settings (
  site_id text PRIMARY KEY,
  temperature_min double precision,
  temperature_max double precision,
  humidity_min double precision,
  humidity_max double precision,
  notifications_enabled boolean NOT NULL DEFAULT true,
  sound_enabled boolean NOT NULL DEFAULT false,
  auto_schedule_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_site_fk
    FOREIGN KEY (site_id) REFERENCES spff.sites(site_id) ON DELETE CASCADE,
  CONSTRAINT site_settings_temperature_check CHECK (
    temperature_min IS NULL OR temperature_max IS NULL OR temperature_min <= temperature_max
  ),
  CONSTRAINT site_settings_humidity_check CHECK (
    humidity_min IS NULL OR humidity_max IS NULL OR humidity_min <= humidity_max
  )
);

CREATE TRIGGER site_settings_set_updated_at
BEFORE UPDATE ON spff.site_settings
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

INSERT INTO spff.site_settings (site_id)
SELECT site_id FROM spff.sites
ON CONFLICT (site_id) DO NOTHING;

CREATE INDEX control_commands_publish_idx
  ON spff.control_commands (issued_at ASC)
  WHERE status = 'pending';

COMMIT;
