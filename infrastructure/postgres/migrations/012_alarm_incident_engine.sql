BEGIN;

ALTER TABLE spff.alarms
  ADD COLUMN IF NOT EXISTS rule_key text,
  ADD COLUMN IF NOT EXISTS incident_key text,
  ADD COLUMN IF NOT EXISTS current_value double precision,
  ADD COLUMN IF NOT EXISTS threshold_text text,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolution_type text;

UPDATE spff.alarms
SET first_seen_at = COALESCE(first_seen_at, triggered_at),
    last_seen_at = COALESCE(last_seen_at, triggered_at)
WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

ALTER TABLE spff.alarms
  ALTER COLUMN first_seen_at SET NOT NULL,
  ALTER COLUMN last_seen_at SET NOT NULL;

ALTER TABLE spff.alarms
  DROP CONSTRAINT IF EXISTS alarms_occurrence_count_check;
ALTER TABLE spff.alarms
  ADD CONSTRAINT alarms_occurrence_count_check
  CHECK (occurrence_count >= 1);

ALTER TABLE spff.alarms
  DROP CONSTRAINT IF EXISTS alarms_resolution_type_check;
ALTER TABLE spff.alarms
  ADD CONSTRAINT alarms_resolution_type_check
  CHECK (
    resolution_type IS NULL
    OR resolution_type IN ('automatic', 'manual')
  );

CREATE UNIQUE INDEX IF NOT EXISTS alarms_active_incident_unique_idx
  ON spff.alarms (site_id, device_id, incident_key)
  WHERE status <> 'resolved' AND incident_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS alarms_site_last_seen_idx
  ON spff.alarms (site_id, last_seen_at DESC, alarm_id DESC);

CREATE TABLE IF NOT EXISTS spff.alarm_rules (
  site_id text NOT NULL,
  rule_key text NOT NULL,
  source_type text NOT NULL
    CHECK (source_type IN ('sensor', 'actuator', 'system')),
  source_key text NOT NULL,
  comparator text NOT NULL
    CHECK (comparator IN ('lt', 'gt', 'fault', 'offline', 'stale', 'failed')),
  threshold_value double precision,
  unit text,
  severity text NOT NULL
    CHECK (severity IN ('info', 'warning', 'critical')),
  trigger_count integer NOT NULL DEFAULT 3 CHECK (trigger_count >= 1),
  recovery_count integer NOT NULL DEFAULT 3 CHECK (recovery_count >= 1),
  title text NOT NULL,
  description text NOT NULL,
  recommendation text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, rule_key),
  CONSTRAINT alarm_rules_site_fk
    FOREIGN KEY (site_id) REFERENCES spff.sites(site_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spff.alarm_events (
  alarm_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alarm_id bigint NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'detected', 'acknowledged', 'escalated',
      'recovered', 'resolved', 'note'
    )
  ),
  from_status text CHECK (
    from_status IS NULL OR from_status IN ('open', 'acknowledged', 'resolved')
  ),
  to_status text CHECK (
    to_status IS NULL OR to_status IN ('open', 'acknowledged', 'resolved')
  ),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  current_value double precision,
  threshold_text text,
  actor text,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb,
  CONSTRAINT alarm_events_alarm_fk
    FOREIGN KEY (alarm_id) REFERENCES spff.alarms(alarm_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS alarm_events_timeline_idx
  ON spff.alarm_events (alarm_id, occurred_at ASC, alarm_event_id ASC);

CREATE TABLE IF NOT EXISTS spff.alarm_rule_states (
  site_id text NOT NULL,
  device_id text NOT NULL,
  rule_key text NOT NULL,
  incident_key text NOT NULL,
  violation_count integer NOT NULL DEFAULT 0 CHECK (violation_count >= 0),
  recovery_count integer NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
  active_alarm_id bigint,
  last_value double precision,
  last_observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, device_id, incident_key),
  CONSTRAINT alarm_rule_states_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE CASCADE,
  CONSTRAINT alarm_rule_states_rule_fk
    FOREIGN KEY (site_id, rule_key)
    REFERENCES spff.alarm_rules(site_id, rule_key) ON DELETE CASCADE,
  CONSTRAINT alarm_rule_states_alarm_fk
    FOREIGN KEY (active_alarm_id)
    REFERENCES spff.alarms(alarm_id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS alarm_rules_updated_at ON spff.alarm_rules;
CREATE TRIGGER alarm_rules_updated_at
BEFORE UPDATE ON spff.alarm_rules
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

DROP TRIGGER IF EXISTS alarm_rule_states_updated_at ON spff.alarm_rule_states;
CREATE TRIGGER alarm_rule_states_updated_at
BEFORE UPDATE ON spff.alarm_rule_states
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

CREATE OR REPLACE FUNCTION spff.sync_environment_alarm_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO spff.alarm_rules (
    site_id, rule_key, source_type, source_key, comparator,
    threshold_value, unit, severity, trigger_count, recovery_count,
    title, description, recommendation, enabled
  )
  VALUES
    (
      NEW.site_id, 'air_temperature_low', 'sensor', 'air_temp', 'lt',
      NEW.temperature_min, '°C', 'warning', 3, 3,
      'Suhu udara terlalu rendah',
      'Suhu udara berada di bawah batas operasional lokasi.',
      'Periksa ventilasi, pemanas, dan posisi sensor suhu.',
      NEW.temperature_min IS NOT NULL
    ),
    (
      NEW.site_id, 'air_temperature_high', 'sensor', 'air_temp', 'gt',
      NEW.temperature_max, '°C', 'warning', 3, 3,
      'Suhu udara terlalu tinggi',
      'Suhu udara berada di atas batas operasional lokasi.',
      'Periksa ventilasi, shading, sirkulasi udara, dan posisi sensor.',
      NEW.temperature_max IS NOT NULL
    ),
    (
      NEW.site_id, 'air_humidity_low', 'sensor', 'air_humidity', 'lt',
      NEW.humidity_min, '%', 'warning', 3, 3,
      'Kelembapan udara terlalu rendah',
      'Kelembapan udara berada di bawah batas operasional lokasi.',
      'Periksa ventilasi, kabut air, dan kondisi lingkungan greenhouse.',
      NEW.humidity_min IS NOT NULL
    ),
    (
      NEW.site_id, 'air_humidity_high', 'sensor', 'air_humidity', 'gt',
      NEW.humidity_max, '%', 'warning', 3, 3,
      'Kelembapan udara terlalu tinggi',
      'Kelembapan udara berada di atas batas operasional lokasi.',
      'Periksa ventilasi dan potensi kondensasi pada area tanaman.',
      NEW.humidity_max IS NOT NULL
    )
  ON CONFLICT (site_id, rule_key) DO UPDATE SET
    threshold_value = EXCLUDED.threshold_value,
    enabled = EXCLUDED.enabled,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_settings_alarm_rules_sync_trg
  ON spff.site_settings;
CREATE TRIGGER site_settings_alarm_rules_sync_trg
AFTER INSERT OR UPDATE OF
  temperature_min, temperature_max, humidity_min, humidity_max
ON spff.site_settings
FOR EACH ROW EXECUTE FUNCTION spff.sync_environment_alarm_rules();

INSERT INTO spff.alarm_rules (
  site_id, rule_key, source_type, source_key, comparator,
  threshold_value, unit, severity, trigger_count, recovery_count,
  title, description, recommendation, enabled
)
SELECT
  settings.site_id,
  rule.rule_key,
  'sensor',
  rule.source_key,
  rule.comparator,
  rule.threshold_value,
  rule.unit,
  'warning',
  3,
  3,
  rule.title,
  rule.description,
  rule.recommendation,
  rule.threshold_value IS NOT NULL
FROM spff.site_settings settings
CROSS JOIN LATERAL (
  VALUES
    (
      'air_temperature_low', 'air_temp', 'lt',
      settings.temperature_min, '°C',
      'Suhu udara terlalu rendah',
      'Suhu udara berada di bawah batas operasional lokasi.',
      'Periksa ventilasi, pemanas, dan posisi sensor suhu.'
    ),
    (
      'air_temperature_high', 'air_temp', 'gt',
      settings.temperature_max, '°C',
      'Suhu udara terlalu tinggi',
      'Suhu udara berada di atas batas operasional lokasi.',
      'Periksa ventilasi, shading, sirkulasi udara, dan posisi sensor.'
    ),
    (
      'air_humidity_low', 'air_humidity', 'lt',
      settings.humidity_min, '%',
      'Kelembapan udara terlalu rendah',
      'Kelembapan udara berada di bawah batas operasional lokasi.',
      'Periksa ventilasi, kabut air, dan kondisi lingkungan greenhouse.'
    ),
    (
      'air_humidity_high', 'air_humidity', 'gt',
      settings.humidity_max, '%',
      'Kelembapan udara terlalu tinggi',
      'Kelembapan udara berada di atas batas operasional lokasi.',
      'Periksa ventilasi dan potensi kondensasi pada area tanaman.'
    )
) AS rule(
  rule_key, source_key, comparator, threshold_value, unit,
  title, description, recommendation
)
ON CONFLICT (site_id, rule_key) DO UPDATE SET
  threshold_value = EXCLUDED.threshold_value,
  enabled = EXCLUDED.enabled,
  updated_at = now();

INSERT INTO spff.alarm_rules (
  site_id, rule_key, source_type, source_key, comparator,
  threshold_value, unit, severity, trigger_count, recovery_count,
  title, description, recommendation, enabled
)
SELECT
  site.site_id,
  rule.rule_key,
  rule.source_type,
  rule.source_key,
  rule.comparator,
  rule.threshold_value,
  rule.unit,
  rule.severity,
  rule.trigger_count,
  rule.recovery_count,
  rule.title,
  rule.description,
  rule.recommendation,
  true
FROM spff.sites site
CROSS JOIN (
  VALUES
    (
      'device_offline', 'system', 'device_status', 'offline',
      300::double precision, 'detik', 'critical', 1, 1,
      'ESP32 offline',
      'Heartbeat perangkat tidak diterima melewati batas waktu.',
      'Periksa daya ESP32, kabel serial, edge gateway, dan koneksi perangkat.'
    ),
    (
      'telemetry_stopped', 'system', 'telemetry', 'stale',
      600::double precision, 'detik', 'warning', 1, 1,
      'Telemetry berhenti',
      'Perangkat belum mengirim telemetry baru melewati batas waktu.',
      'Periksa pembacaan sensor, serial ESP32, dan log edge gateway.'
    ),
    (
      'command_failed', 'system', 'control_command', 'failed',
      NULL::double precision, NULL::text, 'critical', 1, 1,
      'Command aktuator gagal',
      'Command aktuator ditolak, timeout, atau gagal dijalankan.',
      'Periksa ACK firmware, interlock, relay, dan log command dispatcher.'
    ),
    (
      'actuator_fault', 'actuator', '*', 'fault',
      NULL::double precision, NULL::text, 'critical', 1, 1,
      'Aktuator bermasalah',
      'ESP32 melaporkan fault atau offline pada aktuator.',
      'Periksa relay, wiring, catu daya, dan actual state aktuator.'
    )
) AS rule(
  rule_key, source_type, source_key, comparator,
  threshold_value, unit, severity, trigger_count, recovery_count,
  title, description, recommendation
)
ON CONFLICT (site_id, rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION spff.apply_alarm_observation(
  p_site_id text,
  p_device_id text,
  p_rule_key text,
  p_incident_key text,
  p_source_key text,
  p_is_violating boolean,
  p_observed_at timestamptz,
  p_current_value double precision DEFAULT NULL,
  p_threshold_text text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  rule_row spff.alarm_rules%ROWTYPE;
  state_row spff.alarm_rule_states%ROWTYPE;
  current_alarm_id bigint;
  previous_status text;
  next_violation integer;
  next_recovery integer;
  merged_metadata jsonb;
BEGIN
  SELECT *
  INTO rule_row
  FROM spff.alarm_rules
  WHERE site_id = p_site_id
    AND rule_key = p_rule_key
    AND enabled = true;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO spff.alarm_rule_states (
    site_id, device_id, rule_key, incident_key, last_observed_at
  )
  VALUES (
    p_site_id, p_device_id, p_rule_key, p_incident_key, p_observed_at
  )
  ON CONFLICT (site_id, device_id, incident_key) DO NOTHING;

  SELECT *
  INTO state_row
  FROM spff.alarm_rule_states
  WHERE site_id = p_site_id
    AND device_id = p_device_id
    AND incident_key = p_incident_key
  FOR UPDATE;

  merged_metadata :=
    COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'value', p_current_value,
      'threshold', COALESCE(
        p_threshold_text,
        CASE
          WHEN rule_row.threshold_value IS NULL THEN NULL
          ELSE rule_row.threshold_value::text
               || COALESCE(' ' || rule_row.unit, '')
        END
      ),
      'recommendation', rule_row.recommendation
    );

  IF p_is_violating THEN
    next_violation := state_row.violation_count + 1;
    next_recovery := 0;
    current_alarm_id := state_row.active_alarm_id;

    IF current_alarm_id IS NOT NULL THEN
      UPDATE spff.alarms
      SET last_seen_at = GREATEST(last_seen_at, p_observed_at),
          current_value = p_current_value,
          threshold_text = COALESCE(p_threshold_text, threshold_text),
          occurrence_count = occurrence_count + 1,
          metadata = COALESCE(metadata, '{}'::jsonb) || merged_metadata,
          updated_at = now()
      WHERE alarm_id = current_alarm_id
        AND status <> 'resolved'
      RETURNING alarm_id INTO current_alarm_id;
    END IF;

    IF current_alarm_id IS NULL
       AND next_violation >= rule_row.trigger_count THEN
      INSERT INTO spff.alarms (
        site_id, device_id, rule_key, incident_key,
        source_type, source_key, severity, status,
        title, description, triggered_at,
        first_seen_at, last_seen_at, current_value,
        threshold_text, unit, occurrence_count, metadata
      )
      VALUES (
        p_site_id, p_device_id, p_rule_key, p_incident_key,
        rule_row.source_type, COALESCE(NULLIF(p_source_key, ''), rule_row.source_key),
        rule_row.severity, 'open',
        rule_row.title, rule_row.description, p_observed_at,
        p_observed_at, p_observed_at, p_current_value,
        COALESCE(
          p_threshold_text,
          CASE
            WHEN rule_row.threshold_value IS NULL THEN NULL
            ELSE rule_row.threshold_value::text
                 || COALESCE(' ' || rule_row.unit, '')
          END
        ),
        rule_row.unit, 1, merged_metadata
      )
      RETURNING alarm_id INTO current_alarm_id;

      INSERT INTO spff.alarm_events (
        alarm_id, event_type, from_status, to_status, severity,
        current_value, threshold_text, note, occurred_at, metadata
      )
      VALUES (
        current_alarm_id, 'detected', NULL, 'open', rule_row.severity,
        p_current_value, p_threshold_text, rule_row.description,
        p_observed_at, merged_metadata
      );
    END IF;

    UPDATE spff.alarm_rule_states
    SET violation_count = next_violation,
        recovery_count = next_recovery,
        active_alarm_id = current_alarm_id,
        last_value = p_current_value,
        last_observed_at = p_observed_at
    WHERE site_id = p_site_id
      AND device_id = p_device_id
      AND incident_key = p_incident_key;
  ELSE
    next_violation := 0;
    next_recovery := state_row.recovery_count + 1;
    current_alarm_id := state_row.active_alarm_id;

    IF current_alarm_id IS NOT NULL
       AND next_recovery >= rule_row.recovery_count THEN
      SELECT status
      INTO previous_status
      FROM spff.alarms
      WHERE alarm_id = current_alarm_id
        AND status <> 'resolved'
      FOR UPDATE;

      IF FOUND THEN
        UPDATE spff.alarms
        SET status = 'resolved',
            resolved_at = p_observed_at,
            resolved_by = 'alarm-engine',
            resolution_note = 'Kondisi kembali normal.',
            resolution_type = 'automatic',
            last_seen_at = GREATEST(last_seen_at, p_observed_at),
            current_value = p_current_value,
            metadata = COALESCE(metadata, '{}'::jsonb) || merged_metadata,
            updated_at = now()
        WHERE alarm_id = current_alarm_id;

        INSERT INTO spff.alarm_events (
          alarm_id, event_type, from_status, to_status, severity,
          current_value, threshold_text, actor, note, occurred_at, metadata
        )
        VALUES (
          current_alarm_id, 'recovered', previous_status, 'resolved',
          rule_row.severity, p_current_value, p_threshold_text,
          'alarm-engine', 'Kondisi kembali normal.',
          p_observed_at, merged_metadata
        );
      END IF;

      current_alarm_id := NULL;
      next_recovery := 0;
    END IF;

    UPDATE spff.alarm_rule_states
    SET violation_count = next_violation,
        recovery_count = next_recovery,
        active_alarm_id = current_alarm_id,
        last_value = p_current_value,
        last_observed_at = p_observed_at
    WHERE site_id = p_site_id
      AND device_id = p_device_id
      AND incident_key = p_incident_key;
  END IF;

  RETURN current_alarm_id;
END;
$$;

CREATE OR REPLACE FUNCTION spff.notify_alarm_realtime_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'spff_realtime',
    json_build_object(
      'type', 'alarm.updated',
      'siteId', NEW.site_id,
      'deviceId', NEW.device_id,
      'messageId', NEW.alarm_id::text,
      'recordedAt', NEW.updated_at,
      'receivedAt', clock_timestamp()
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alarms_realtime_notify_trg ON spff.alarms;
CREATE TRIGGER alarms_realtime_notify_trg
AFTER INSERT OR UPDATE ON spff.alarms
FOR EACH ROW EXECUTE FUNCTION spff.notify_alarm_realtime_event();

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'spff_api_role',
    'spff_app',
    'spff_worker_role',
    'spff_worker'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT SELECT ON spff.alarm_rules, spff.alarm_rule_states, spff.alarm_events, spff.alarms TO %I',
        role_name
      );
      EXECUTE format(
        'GRANT INSERT, UPDATE ON spff.alarm_rule_states, spff.alarm_events, spff.alarms TO %I',
        role_name
      );
      EXECUTE format(
        'GRANT USAGE, SELECT ON SEQUENCE spff.alarms_alarm_id_seq, spff.alarm_events_alarm_event_id_seq TO %I',
        role_name
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION spff.apply_alarm_observation(text, text, text, text, text, boolean, timestamptz, double precision, text, jsonb) TO %I',
        role_name
      );
    END IF;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['spff_worker_role', 'spff_worker']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT SELECT ON spff.telemetry_samples, spff.device_status_events TO %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup_role') THEN
    GRANT SELECT ON
      spff.alarm_rules,
      spff.alarm_rule_states,
      spff.alarm_events
    TO spff_backup_role;
    GRANT SELECT ON SEQUENCE
      spff.alarms_alarm_id_seq,
      spff.alarm_events_alarm_event_id_seq
      TO spff_backup_role;
  END IF;
END;
$$;

COMMENT ON TABLE spff.alarm_rules IS
  'Configurable alarm rules evaluated from telemetry, device health, commands, and actual actuator state.';
COMMENT ON TABLE spff.alarm_rule_states IS
  'Durable debounce and recovery counters preventing duplicate or flapping alarm incidents.';
COMMENT ON TABLE spff.alarm_events IS
  'Immutable lifecycle timeline for each alarm incident.';
COMMENT ON FUNCTION spff.apply_alarm_observation IS
  'Applies one rule observation with durable debounce, deduplication, and automatic recovery.';

COMMIT;
