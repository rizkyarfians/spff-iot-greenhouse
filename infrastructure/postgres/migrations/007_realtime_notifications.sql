BEGIN;

CREATE OR REPLACE FUNCTION spff.notify_realtime_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_type text;
BEGIN
  event_type := CASE TG_TABLE_NAME
    WHEN 'telemetry_samples' THEN 'telemetry.updated'
    WHEN 'device_status_events' THEN 'device_status.updated'
    ELSE NULL
  END;

  IF event_type IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_notify(
    'spff_realtime',
    json_build_object(
      'type', event_type,
      'siteId', NEW.site_id,
      'deviceId', NEW.device_id,
      'messageId', NEW.message_id,
      'recordedAt', NEW.recorded_at,
      'receivedAt', NEW.received_at
    )::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS telemetry_realtime_notify_trg
  ON spff.telemetry_samples;

CREATE TRIGGER telemetry_realtime_notify_trg
AFTER INSERT ON spff.telemetry_samples
FOR EACH ROW
EXECUTE FUNCTION spff.notify_realtime_event();

DROP TRIGGER IF EXISTS device_status_realtime_notify_trg
  ON spff.device_status_events;

CREATE TRIGGER device_status_realtime_notify_trg
AFTER INSERT ON spff.device_status_events
FOR EACH ROW
EXECUTE FUNCTION spff.notify_realtime_event();

COMMENT ON FUNCTION spff.notify_realtime_event() IS
  'Publishes compact post-commit telemetry/device status signals for the local SSE API.';

COMMIT;
