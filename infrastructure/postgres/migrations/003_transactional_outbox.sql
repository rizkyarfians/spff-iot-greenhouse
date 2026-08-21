BEGIN;

CREATE TABLE IF NOT EXISTS spff.schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO spff.schema_migrations (version, name)
VALUES
  (1, '001_initial_schema'),
  (2, '002_production_readiness'),
  (3, '003_transactional_outbox')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS spff.cloud_outbox (
  outbox_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'synced', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS cloud_outbox_pending_idx
  ON spff.cloud_outbox (available_at, outbox_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS cloud_outbox_site_created_idx
  ON spff.cloud_outbox (site_id, created_at DESC)
  WHERE site_id IS NOT NULL;

CREATE OR REPLACE FUNCTION spff.enqueue_cloud_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, spff
AS $$
DECLARE
  row_data jsonb;
  id_key text;
  aggregate_parts text[] := ARRAY[]::text[];
  part text;
  outbox_operation text;
  resolved_site_id text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  outbox_operation := lower(TG_OP);
  resolved_site_id := row_data ->> 'site_id';

  IF resolved_site_id IS NULL AND TG_ARGV[0] = 'command_ack' THEN
    SELECT site_id INTO resolved_site_id
    FROM spff.control_commands
    WHERE command_id = row_data ->> 'command_id';
    row_data := jsonb_build_object('site_id', resolved_site_id) || row_data;
  END IF;

  FOREACH id_key IN ARRAY string_to_array(TG_ARGV[1], ',') LOOP
    part := row_data ->> trim(id_key);
    aggregate_parts := array_append(aggregate_parts, COALESCE(part, ''));
  END LOOP;

  INSERT INTO spff.cloud_outbox (
    site_id,
    aggregate_type,
    aggregate_id,
    operation,
    payload
  ) VALUES (
    resolved_site_id,
    TG_ARGV[0],
    array_to_string(aggregate_parts, ':'),
    outbox_operation,
    row_data
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION spff.enqueue_cloud_outbox() FROM PUBLIC;

DROP TRIGGER IF EXISTS telemetry_cloud_outbox_trg ON spff.telemetry_samples;
CREATE TRIGGER telemetry_cloud_outbox_trg
AFTER INSERT ON spff.telemetry_samples
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('telemetry', 'device_id,message_id');

DROP TRIGGER IF EXISTS control_command_cloud_outbox_trg ON spff.control_commands;
CREATE TRIGGER control_command_cloud_outbox_trg
AFTER INSERT OR UPDATE ON spff.control_commands
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('command', 'command_id');

DROP TRIGGER IF EXISTS command_ack_cloud_outbox_trg ON spff.command_ack_events;
CREATE TRIGGER command_ack_cloud_outbox_trg
AFTER INSERT ON spff.command_ack_events
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('command_ack', 'command_id,status,acknowledged_at');

DROP TRIGGER IF EXISTS actuator_state_cloud_outbox_trg ON spff.actuator_state_events;
CREATE TRIGGER actuator_state_cloud_outbox_trg
AFTER INSERT ON spff.actuator_state_events
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('actuator_state', 'device_id,actuator_key,actuator_state_id');

DROP TRIGGER IF EXISTS device_status_cloud_outbox_trg ON spff.device_status_events;
CREATE TRIGGER device_status_cloud_outbox_trg
AFTER INSERT ON spff.device_status_events
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('device_status', 'device_id,device_status_id');

DROP TRIGGER IF EXISTS alarm_cloud_outbox_trg ON spff.alarms;
CREATE TRIGGER alarm_cloud_outbox_trg
AFTER INSERT OR UPDATE ON spff.alarms
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('alarm', 'alarm_id');

DROP TRIGGER IF EXISTS schedule_cloud_outbox_trg ON spff.actuator_schedules;
CREATE TRIGGER schedule_cloud_outbox_trg
AFTER INSERT OR UPDATE OR DELETE ON spff.actuator_schedules
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('schedule', 'schedule_id');

DROP TRIGGER IF EXISTS settings_cloud_outbox_trg ON spff.site_settings;
CREATE TRIGGER settings_cloud_outbox_trg
AFTER INSERT OR UPDATE ON spff.site_settings
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('site_settings', 'site_id');

DROP TRIGGER IF EXISTS site_cloud_outbox_trg ON spff.sites;
CREATE TRIGGER site_cloud_outbox_trg
AFTER INSERT OR UPDATE ON spff.sites
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('site', 'site_id');

DROP TRIGGER IF EXISTS device_cloud_outbox_trg ON spff.devices;
CREATE TRIGGER device_cloud_outbox_trg
AFTER INSERT OR UPDATE ON spff.devices
FOR EACH ROW EXECUTE FUNCTION spff.enqueue_cloud_outbox('device', 'device_id');

COMMIT;
