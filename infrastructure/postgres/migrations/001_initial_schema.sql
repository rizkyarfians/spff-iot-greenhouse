BEGIN;

CREATE SCHEMA IF NOT EXISTS spff;

CREATE TABLE spff.sites (
  site_id text PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spff.devices (
  site_id text NOT NULL,
  device_id text NOT NULL,
  display_name text NOT NULL,
  hardware_model text,
  firmware_version text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, device_id),
  CONSTRAINT devices_site_fk
    FOREIGN KEY (site_id) REFERENCES spff.sites(site_id) ON DELETE RESTRICT
);

CREATE TABLE spff.sensor_definitions (
  sensor_key text PRIMARY KEY,
  group_name text NOT NULL,
  display_name text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('float', 'integer')),
  unit text NOT NULL,
  sort_order smallint NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE spff.telemetry_samples (
  telemetry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  site_id text NOT NULL,
  device_id text NOT NULL,
  message_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),

  soil_1_moisture double precision,
  soil_1_temp double precision,
  soil_1_ec_us_cm double precision,
  soil_1_ph double precision,
  soil_1_n integer,
  soil_1_p integer,
  soil_1_k integer,

  soil_2_moisture double precision,
  soil_2_temp double precision,
  soil_2_ec_us_cm double precision,
  soil_2_ph double precision,
  soil_2_n integer,
  soil_2_p integer,
  soil_2_k integer,

  liquid_ph double precision,
  liquid_ec_us_cm double precision,
  liquid_temp double precision,

  air_temp double precision,
  air_humidity double precision,

  tank_water_distance_cm double precision,
  tank_water_level_pct double precision,
  tank_fert_distance_cm double precision,
  tank_fert_level_pct double precision,

  flow_water_lpm double precision,
  flow_water_total_l double precision,
  flow_fert_lpm double precision,
  flow_fert_total_l double precision,

  battery_voltage double precision,
  sensor_valid boolean NOT NULL DEFAULT true,
  raw_payload jsonb,

  CONSTRAINT telemetry_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE RESTRICT,
  CONSTRAINT telemetry_message_unique
    UNIQUE (site_id, device_id, message_id)
);

CREATE INDEX telemetry_device_recorded_idx
  ON spff.telemetry_samples (site_id, device_id, recorded_at DESC);

CREATE INDEX telemetry_device_sequence_idx
  ON spff.telemetry_samples (site_id, device_id, sequence DESC);

CREATE TABLE spff.actuators (
  site_id text NOT NULL,
  device_id text NOT NULL,
  actuator_key text NOT NULL,
  display_name text NOT NULL,
  actuator_type text NOT NULL DEFAULT 'pump',
  max_runtime_seconds integer CHECK (max_runtime_seconds IS NULL OR max_runtime_seconds > 0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, device_id, actuator_key),
  CONSTRAINT actuators_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE RESTRICT
);

CREATE TABLE spff.control_commands (
  command_id text PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  actuator_key text NOT NULL,
  command_type text NOT NULL DEFAULT 'set_pump' CHECK (command_type = 'set_pump'),
  requested_is_active boolean NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'accepted', 'completed', 'rejected', 'timed_out', 'failed')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  published_at timestamptz,
  completed_at timestamptz,
  reason text,
  request_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commands_actuator_fk
    FOREIGN KEY (site_id, device_id, actuator_key)
    REFERENCES spff.actuators(site_id, device_id, actuator_key) ON DELETE RESTRICT,
  CONSTRAINT commands_expiry_check CHECK (expires_at > issued_at)
);

CREATE INDEX commands_device_status_idx
  ON spff.control_commands (site_id, device_id, status, issued_at DESC);

CREATE INDEX commands_pending_expiry_idx
  ON spff.control_commands (expires_at)
  WHERE status IN ('pending', 'published', 'accepted');

CREATE TABLE spff.command_ack_events (
  ack_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('accepted', 'completed', 'rejected', 'timed_out')),
  actual_is_active boolean,
  reason text,
  acknowledged_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  CONSTRAINT command_ack_command_fk
    FOREIGN KEY (command_id) REFERENCES spff.control_commands(command_id) ON DELETE RESTRICT,
  CONSTRAINT command_ack_idempotency_unique
    UNIQUE (command_id, status, acknowledged_at)
);

CREATE INDEX command_ack_command_idx
  ON spff.command_ack_events (command_id, acknowledged_at DESC);

CREATE TABLE spff.actuator_state_events (
  actuator_state_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  actuator_key text NOT NULL,
  message_id text,
  command_id text,
  source text NOT NULL
    CHECK (source IN ('telemetry', 'command_ack', 'manual', 'system')),
  state text NOT NULL
    CHECK (state IN ('active', 'inactive', 'processing', 'offline', 'fault')),
  is_active boolean,
  reason text,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  CONSTRAINT actuator_state_actuator_fk
    FOREIGN KEY (site_id, device_id, actuator_key)
    REFERENCES spff.actuators(site_id, device_id, actuator_key) ON DELETE RESTRICT,
  CONSTRAINT actuator_state_command_fk
    FOREIGN KEY (command_id) REFERENCES spff.control_commands(command_id) ON DELETE RESTRICT,
  CONSTRAINT actuator_state_active_check CHECK (
    (state = 'active' AND is_active IS true)
    OR (state = 'inactive' AND is_active IS false)
    OR state IN ('processing', 'offline', 'fault')
  )
);

CREATE UNIQUE INDEX actuator_state_message_unique_idx
  ON spff.actuator_state_events (site_id, device_id, actuator_key, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX actuator_state_latest_idx
  ON spff.actuator_state_events
  (site_id, device_id, actuator_key, recorded_at DESC, actuator_state_id DESC);

CREATE TABLE spff.device_status_events (
  device_status_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  message_id text,
  online boolean NOT NULL,
  mode text CHECK (mode IS NULL OR mode IN ('manual', 'automatic')),
  firmware_version text,
  system_state text,
  growth_phase text,
  sensor_valid boolean,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  CONSTRAINT device_status_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX device_status_message_unique_idx
  ON spff.device_status_events (site_id, device_id, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX device_status_latest_idx
  ON spff.device_status_events
  (site_id, device_id, recorded_at DESC, device_status_id DESC);

CREATE TABLE spff.system_logs (
  log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text,
  device_id text,
  component text NOT NULL,
  level text NOT NULL CHECK (level IN ('debug', 'info', 'warning', 'error', 'critical')),
  event_code text,
  message text NOT NULL,
  message_id text,
  command_id text,
  context jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_logs_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE RESTRICT,
  CONSTRAINT system_logs_identity_check CHECK (
    (site_id IS NULL AND device_id IS NULL)
    OR (site_id IS NOT NULL AND device_id IS NOT NULL)
  )
);

CREATE INDEX system_logs_occurred_idx
  ON spff.system_logs (occurred_at DESC);

CREATE INDEX system_logs_device_occurred_idx
  ON spff.system_logs (site_id, device_id, occurred_at DESC)
  WHERE site_id IS NOT NULL;

CREATE TABLE spff.alarms (
  alarm_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('sensor', 'actuator', 'system')),
  source_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  title text NOT NULL,
  description text NOT NULL,
  triggered_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alarms_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE RESTRICT,
  CONSTRAINT alarms_ack_check CHECK (
    (acknowledged_at IS NULL AND acknowledged_by IS NULL)
    OR (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)
  ),
  CONSTRAINT alarms_resolved_check CHECK (
    status <> 'resolved' OR resolved_at IS NOT NULL
  )
);

CREATE INDEX alarms_open_idx
  ON spff.alarms (site_id, device_id, severity, triggered_at DESC)
  WHERE status <> 'resolved';

INSERT INTO spff.sensor_definitions
  (sensor_key, group_name, display_name, value_type, unit, sort_order)
VALUES
  ('soil_1_moisture', 'Soil Sensor 1', 'Kelembapan Tanah 1', 'float', '%', 1),
  ('soil_1_temp', 'Soil Sensor 1', 'Suhu Tanah 1', 'float', '°C', 2),
  ('soil_1_ec_us_cm', 'Soil Sensor 1', 'EC Tanah 1', 'float', 'µS/cm', 3),
  ('soil_1_ph', 'Soil Sensor 1', 'pH Tanah 1', 'float', 'pH', 4),
  ('soil_1_n', 'Soil Sensor 1', 'Nitrogen Tanah 1', 'integer', 'mg/kg', 5),
  ('soil_1_p', 'Soil Sensor 1', 'Fosfor Tanah 1', 'integer', 'mg/kg', 6),
  ('soil_1_k', 'Soil Sensor 1', 'Kalium Tanah 1', 'integer', 'mg/kg', 7),
  ('soil_2_moisture', 'Soil Sensor 2', 'Kelembapan Tanah 2', 'float', '%', 8),
  ('soil_2_temp', 'Soil Sensor 2', 'Suhu Tanah 2', 'float', '°C', 9),
  ('soil_2_ec_us_cm', 'Soil Sensor 2', 'EC Tanah 2', 'float', 'µS/cm', 10),
  ('soil_2_ph', 'Soil Sensor 2', 'pH Tanah 2', 'float', 'pH', 11),
  ('soil_2_n', 'Soil Sensor 2', 'Nitrogen Tanah 2', 'integer', 'mg/kg', 12),
  ('soil_2_p', 'Soil Sensor 2', 'Fosfor Tanah 2', 'integer', 'mg/kg', 13),
  ('soil_2_k', 'Soil Sensor 2', 'Kalium Tanah 2', 'integer', 'mg/kg', 14),
  ('liquid_ph', 'Nutrisense', 'pH Larutan', 'float', 'pH', 15),
  ('liquid_ec_us_cm', 'Nutrisense', 'EC Larutan', 'float', 'µS/cm', 16),
  ('liquid_temp', 'Nutrisense', 'Suhu Larutan', 'float', '°C', 17),
  ('air_temp', 'SHT20', 'Suhu Udara', 'float', '°C', 18),
  ('air_humidity', 'SHT20', 'Kelembapan Udara', 'float', '%RH', 19),
  ('tank_water_distance_cm', 'Tandon air', 'Jarak Permukaan Air', 'float', 'cm', 20),
  ('tank_water_level_pct', 'Tandon air', 'Level Tandon Air', 'float', '%', 21),
  ('tank_fert_distance_cm', 'Tandon pupuk', 'Jarak Permukaan Pupuk', 'float', 'cm', 22),
  ('tank_fert_level_pct', 'Tandon pupuk', 'Level Tandon Pupuk', 'float', '%', 23),
  ('flow_water_lpm', 'Flow air', 'Debit Air', 'float', 'L/min', 24),
  ('flow_water_total_l', 'Flow air', 'Total Air', 'float', 'L', 25),
  ('flow_fert_lpm', 'Flow pupuk', 'Debit Pupuk', 'float', 'L/min', 26),
  ('flow_fert_total_l', 'Flow pupuk', 'Total Pupuk', 'float', 'L', 27),
  ('battery_voltage', 'Daya', 'Tegangan Baterai', 'float', 'V', 28)
ON CONFLICT (sensor_key) DO NOTHING;

CREATE OR REPLACE VIEW spff.latest_telemetry AS
SELECT DISTINCT ON (site_id, device_id)
  telemetry_id,
  schema_version,
  site_id,
  device_id,
  message_id,
  sequence,
  recorded_at,
  received_at,
  soil_1_moisture,
  soil_1_temp,
  soil_1_ec_us_cm,
  soil_1_ph,
  soil_1_n,
  soil_1_p,
  soil_1_k,
  soil_2_moisture,
  soil_2_temp,
  soil_2_ec_us_cm,
  soil_2_ph,
  soil_2_n,
  soil_2_p,
  soil_2_k,
  liquid_ph,
  liquid_ec_us_cm,
  liquid_temp,
  air_temp,
  air_humidity,
  tank_water_distance_cm,
  tank_water_level_pct,
  tank_fert_distance_cm,
  tank_fert_level_pct,
  flow_water_lpm,
  flow_water_total_l,
  flow_fert_lpm,
  flow_fert_total_l,
  battery_voltage,
  sensor_valid
FROM spff.telemetry_samples
ORDER BY site_id, device_id, recorded_at DESC, telemetry_id DESC;

CREATE OR REPLACE VIEW spff.latest_actuator_states AS
SELECT DISTINCT ON (site_id, device_id, actuator_key)
  actuator_state_id,
  site_id,
  device_id,
  actuator_key,
  state,
  is_active,
  source,
  command_id,
  reason,
  recorded_at,
  received_at
FROM spff.actuator_state_events
ORDER BY site_id, device_id, actuator_key, recorded_at DESC, actuator_state_id DESC;

CREATE OR REPLACE VIEW spff.latest_device_status AS
SELECT DISTINCT ON (site_id, device_id)
  device_status_id,
  site_id,
  device_id,
  online,
  mode,
  firmware_version,
  system_state,
  growth_phase,
  sensor_valid,
  recorded_at,
  received_at
FROM spff.device_status_events
ORDER BY site_id, device_id, recorded_at DESC, device_status_id DESC;

CREATE OR REPLACE FUNCTION spff.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_set_updated_at
BEFORE UPDATE ON spff.sites
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

CREATE TRIGGER devices_set_updated_at
BEFORE UPDATE ON spff.devices
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

CREATE TRIGGER actuators_set_updated_at
BEFORE UPDATE ON spff.actuators
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

CREATE TRIGGER commands_set_updated_at
BEFORE UPDATE ON spff.control_commands
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

CREATE TRIGGER alarms_set_updated_at
BEFORE UPDATE ON spff.alarms
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

COMMENT ON TABLE spff.telemetry_samples IS
  'One append-only row per ESP32 telemetry message. Nullable sensor columns preserve missing/offline values as gaps.';

COMMENT ON COLUMN spff.telemetry_samples.recorded_at IS
  'UTC timestamp produced by ESP32/RTC; maps from JSON key timestamp/recordedAt.';

COMMENT ON COLUMN spff.telemetry_samples.received_at IS
  'UTC timestamp assigned by the local MQTT ingestion worker.';

COMMENT ON TABLE spff.actuator_state_events IS
  'Authoritative actuator-state history reported by ESP32; dashboard commands do not directly change this table.';

COMMENT ON TABLE spff.control_commands IS
  'Lifecycle of dashboard/API commands. A command is completed only after a final ESP32 acknowledgement.';

COMMIT;
