BEGIN;

CREATE TABLE IF NOT EXISTS spff.device_automatic_control_configs (
  site_id text NOT NULL,
  device_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  desired_mode text NOT NULL DEFAULT 'manual'
    CHECK (desired_mode IN ('manual', 'automatic')),

  water_enabled boolean NOT NULL DEFAULT false,
  water_sensor_key text NOT NULL DEFAULT 'soil_1_moisture'
    CHECK (water_sensor_key IN ('soil_1_moisture', 'soil_2_moisture')),
  water_moisture_low_pct double precision,
  water_moisture_target_pct double precision,
  water_max_runtime_seconds integer,
  water_cooldown_seconds integer,
  water_min_tank_level_pct double precision,
  water_min_flow_lpm double precision,
  water_trigger_sample_count integer NOT NULL DEFAULT 3
    CHECK (water_trigger_sample_count BETWEEN 1 AND 20),
  water_sensor_stale_seconds integer NOT NULL DEFAULT 120
    CHECK (water_sensor_stale_seconds BETWEEN 10 AND 3600),

  fertilizer_enabled boolean NOT NULL DEFAULT false,
  fertilizer_sensor_key text NOT NULL DEFAULT 'liquid_ec_us_cm'
    CHECK (fertilizer_sensor_key = 'liquid_ec_us_cm'),
  fertilizer_ec_low_us_cm double precision,
  fertilizer_ec_target_us_cm double precision,
  fertilizer_ec_high_us_cm double precision,
  fertilizer_dose_pulse_seconds integer,
  fertilizer_mixing_delay_seconds integer,
  fertilizer_cooldown_seconds integer,
  fertilizer_max_dose_volume_l double precision,
  fertilizer_max_daily_volume_l double precision,
  fertilizer_min_tank_level_pct double precision,
  fertilizer_min_flow_lpm double precision,
  fertilizer_trigger_sample_count integer NOT NULL DEFAULT 3
    CHECK (fertilizer_trigger_sample_count BETWEEN 1 AND 20),
  fertilizer_sensor_stale_seconds integer NOT NULL DEFAULT 120
    CHECK (fertilizer_sensor_stale_seconds BETWEEN 10 AND 3600),

  published_revision bigint,
  published_at timestamptz,
  acknowledged_revision bigint,
  acknowledgement_status text
    CHECK (acknowledgement_status IS NULL OR acknowledgement_status IN ('applied', 'rejected')),
  acknowledged_at timestamptz,
  acknowledgement_reason text,
  applied_mode text
    CHECK (applied_mode IS NULL OR applied_mode IN ('manual', 'automatic')),
  updated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (site_id, device_id),
  CONSTRAINT automatic_control_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE CASCADE,
  CONSTRAINT automatic_control_mode_ready_check
    CHECK (desired_mode <> 'automatic' OR water_enabled OR fertilizer_enabled),
  CONSTRAINT automatic_control_water_values_check
    CHECK (
      (water_moisture_low_pct IS NULL OR water_moisture_low_pct BETWEEN 0 AND 100)
      AND (water_moisture_target_pct IS NULL OR water_moisture_target_pct BETWEEN 0 AND 100)
      AND (water_max_runtime_seconds IS NULL OR water_max_runtime_seconds BETWEEN 1 AND 86400)
      AND (water_cooldown_seconds IS NULL OR water_cooldown_seconds BETWEEN 0 AND 86400)
      AND (water_min_tank_level_pct IS NULL OR water_min_tank_level_pct BETWEEN 0 AND 100)
      AND (water_min_flow_lpm IS NULL OR water_min_flow_lpm BETWEEN 0 AND 10000)
      AND (
        NOT water_enabled
        OR (
          water_moisture_low_pct IS NOT NULL
          AND water_moisture_target_pct IS NOT NULL
          AND water_moisture_low_pct < water_moisture_target_pct
          AND water_max_runtime_seconds IS NOT NULL
          AND water_cooldown_seconds IS NOT NULL
          AND water_min_flow_lpm IS NOT NULL
        )
      )
    ),
  CONSTRAINT automatic_control_fertilizer_values_check
    CHECK (
      (fertilizer_ec_low_us_cm IS NULL OR fertilizer_ec_low_us_cm BETWEEN 0 AND 100000)
      AND (fertilizer_ec_target_us_cm IS NULL OR fertilizer_ec_target_us_cm BETWEEN 0 AND 100000)
      AND (fertilizer_ec_high_us_cm IS NULL OR fertilizer_ec_high_us_cm BETWEEN 0 AND 100000)
      AND (fertilizer_dose_pulse_seconds IS NULL OR fertilizer_dose_pulse_seconds BETWEEN 1 AND 3600)
      AND (fertilizer_mixing_delay_seconds IS NULL OR fertilizer_mixing_delay_seconds BETWEEN 1 AND 86400)
      AND (fertilizer_cooldown_seconds IS NULL OR fertilizer_cooldown_seconds BETWEEN 0 AND 86400)
      AND (fertilizer_max_dose_volume_l IS NULL OR fertilizer_max_dose_volume_l BETWEEN 0.001 AND 100000)
      AND (fertilizer_max_daily_volume_l IS NULL OR fertilizer_max_daily_volume_l BETWEEN 0.001 AND 1000000)
      AND (fertilizer_min_tank_level_pct IS NULL OR fertilizer_min_tank_level_pct BETWEEN 0 AND 100)
      AND (fertilizer_min_flow_lpm IS NULL OR fertilizer_min_flow_lpm BETWEEN 0 AND 10000)
      AND (
        NOT fertilizer_enabled
        OR (
          fertilizer_ec_low_us_cm IS NOT NULL
          AND fertilizer_ec_target_us_cm IS NOT NULL
          AND fertilizer_ec_high_us_cm IS NOT NULL
          AND fertilizer_ec_low_us_cm < fertilizer_ec_target_us_cm
          AND fertilizer_ec_target_us_cm < fertilizer_ec_high_us_cm
          AND fertilizer_dose_pulse_seconds IS NOT NULL
          AND fertilizer_mixing_delay_seconds IS NOT NULL
          AND fertilizer_cooldown_seconds IS NOT NULL
          AND fertilizer_max_dose_volume_l IS NOT NULL
          AND fertilizer_max_daily_volume_l IS NOT NULL
          AND fertilizer_max_dose_volume_l <= fertilizer_max_daily_volume_l
          AND fertilizer_min_flow_lpm IS NOT NULL
        )
      )
    )
);

CREATE TABLE IF NOT EXISTS spff.automatic_control_ack_events (
  automatic_control_ack_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('applied', 'rejected')),
  applied_mode text NOT NULL CHECK (applied_mode IN ('manual', 'automatic')),
  reason text,
  acknowledged_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL,
  CONSTRAINT automatic_control_ack_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE RESTRICT,
  CONSTRAINT automatic_control_ack_unique
    UNIQUE (site_id, device_id, revision, status, acknowledged_at)
);

CREATE INDEX IF NOT EXISTS automatic_control_ack_recent_idx
  ON spff.automatic_control_ack_events
  (site_id, device_id, received_at DESC, automatic_control_ack_id DESC);

DROP TRIGGER IF EXISTS automatic_control_updated_at
  ON spff.device_automatic_control_configs;
CREATE TRIGGER automatic_control_updated_at
BEFORE UPDATE ON spff.device_automatic_control_configs
FOR EACH ROW EXECUTE FUNCTION spff.set_updated_at();

CREATE OR REPLACE FUNCTION spff.notify_automatic_control_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'spff_realtime',
    json_build_object(
      'type', 'automatic_control.updated',
      'siteId', NEW.site_id,
      'deviceId', NEW.device_id,
      'messageId', NEW.revision::text,
      'recordedAt', NEW.updated_at,
      'receivedAt', clock_timestamp()
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS automatic_control_realtime_notify_trg
  ON spff.device_automatic_control_configs;
CREATE TRIGGER automatic_control_realtime_notify_trg
AFTER INSERT OR UPDATE ON spff.device_automatic_control_configs
FOR EACH ROW EXECUTE FUNCTION spff.notify_automatic_control_event();

CREATE OR REPLACE FUNCTION spff.bump_schedule_revision_for_automatic_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, spff
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR OLD.desired_mode IS DISTINCT FROM NEW.desired_mode
  THEN
    INSERT INTO spff.device_schedule_sync_state (
      site_id,
      device_id,
      revision,
      updated_at
    )
    VALUES (
      NEW.site_id,
      NEW.device_id,
      1,
      clock_timestamp()
    )
    ON CONFLICT (site_id, device_id) DO UPDATE SET
      revision = spff.device_schedule_sync_state.revision + 1,
      updated_at = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
  spff.bump_schedule_revision_for_automatic_mode()
FROM PUBLIC;

DROP TRIGGER IF EXISTS automatic_control_schedule_revision_trg
  ON spff.device_automatic_control_configs;
CREATE TRIGGER automatic_control_schedule_revision_trg
AFTER INSERT OR UPDATE
ON spff.device_automatic_control_configs
FOR EACH ROW
EXECUTE FUNCTION spff.bump_schedule_revision_for_automatic_mode();

INSERT INTO spff.device_automatic_control_configs (
  site_id,
  device_id
)
SELECT
  device.site_id,
  device.device_id
FROM spff.devices device
WHERE device.enabled = true
ON CONFLICT (site_id, device_id) DO NOTHING;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_app', 'spff_api_role', 'spff_worker_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON spff.device_automatic_control_configs TO %I',
        role_name
      );
      EXECUTE format(
        'GRANT SELECT, INSERT ON spff.automatic_control_ack_events TO %I',
        role_name
      );
      EXECUTE format(
        'GRANT USAGE, SELECT ON SEQUENCE spff.automatic_control_ack_events_automatic_control_ack_id_seq TO %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup_role') THEN
    GRANT SELECT ON
      spff.device_automatic_control_configs,
      spff.automatic_control_ack_events
    TO spff_backup_role;
    GRANT SELECT ON SEQUENCE
      spff.automatic_control_ack_events_automatic_control_ack_id_seq
    TO spff_backup_role;
  END IF;
END;
$$;

COMMENT ON TABLE spff.device_automatic_control_configs IS
  'Versioned desired automatic-control mode and safety configuration per device.';
COMMENT ON TABLE spff.automatic_control_ack_events IS
  'Immutable firmware acknowledgements for automatic-control configuration revisions.';

COMMIT;
