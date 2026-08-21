BEGIN;

CREATE TABLE IF NOT EXISTS spff.actuator_schedule_runs (
  schedule_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  action text NOT NULL CHECK (action IN ('on', 'off')),
  command_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT actuator_schedule_runs_occurrence_unique
    UNIQUE (schedule_id, scheduled_for, action),
  CONSTRAINT actuator_schedule_runs_command_fk
    FOREIGN KEY (command_id)
    REFERENCES spff.control_commands(command_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS actuator_schedule_runs_scheduled_idx
  ON spff.actuator_schedule_runs (scheduled_for DESC);

COMMIT;
