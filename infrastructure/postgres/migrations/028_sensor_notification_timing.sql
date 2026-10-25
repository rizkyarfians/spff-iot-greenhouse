BEGIN;

-- One bounded row per device, not a history scan on every dashboard refresh.
CREATE TABLE spff.sensor_notification_timing (
  site_id text NOT NULL,
  device_id text NOT NULL,
  recorded_at timestamptz,
  sensor_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (site_id, device_id)
);

CREATE FUNCTION spff.track_sensor_notification_timing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, spff AS $$
DECLARE
  state_row spff.sensor_notification_timing%ROWTYPE;
  item record;
  previous jsonb;
  next_state jsonb;
  sample_data jsonb;
BEGIN
  -- Ignore implausible future clocks and historical replay. Never use this
  -- notification-only table for control or safety admission.
  IF NEW.recorded_at > NEW.received_at + interval '2 minutes' THEN RETURN NEW; END IF;
  INSERT INTO spff.sensor_notification_timing(site_id, device_id)
    VALUES (NEW.site_id, NEW.device_id) ON CONFLICT DO NOTHING;
  SELECT * INTO state_row FROM spff.sensor_notification_timing
    WHERE site_id=NEW.site_id AND device_id=NEW.device_id FOR UPDATE;
  IF state_row.recorded_at IS NOT NULL AND NEW.recorded_at <= state_row.recorded_at THEN
    RETURN NEW;
  END IF;
  next_state := state_row.sensor_state;
  sample_data := to_jsonb(NEW);
  FOR item IN SELECT key, value FROM jsonb_each(COALESCE(NEW.sensor_health, '{}'::jsonb)) LOOP
    previous := COALESCE(next_state->item.key, '{}'::jsonb);
    IF item.value->'valid' = 'true'::jsonb
       AND jsonb_typeof(sample_data->item.key) = 'number' THEN
      next_state := jsonb_set(next_state, ARRAY[item.key], jsonb_build_object(
        'lastValidAt', NEW.recorded_at, 'invalidSince', NULL));
    ELSIF item.value->'valid' = 'false'::jsonb
          AND COALESCE(item.value->>'reason', '') <> 'not_reported' THEN
      next_state := jsonb_set(next_state, ARRAY[item.key], jsonb_build_object(
        'lastValidAt', previous->'lastValidAt',
        'invalidSince', COALESCE(NULLIF(previous->'invalidSince', 'null'::jsonb), to_jsonb(NEW.received_at))));
    END IF;
  END LOOP;
  UPDATE spff.sensor_notification_timing SET recorded_at=NEW.recorded_at, sensor_state=next_state
    WHERE site_id=NEW.site_id AND device_id=NEW.device_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION spff.track_sensor_notification_timing() FROM PUBLIC;
CREATE TRIGGER track_sensor_notification_timing
AFTER INSERT ON spff.telemetry_samples FOR EACH ROW
EXECUTE FUNCTION spff.track_sensor_notification_timing();

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['spff_app','spff_api','spff_api_role','spff_backup_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON spff.sensor_notification_timing TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE spff.sensor_notification_timing IS
  'Notification-only timing from new telemetry after migration; no historical backfill, no control authority.';
COMMIT;
