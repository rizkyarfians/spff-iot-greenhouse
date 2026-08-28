BEGIN;

CREATE TABLE spff.device_schedule_sync_state (
  site_id text NOT NULL,
  device_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  published_revision bigint,
  published_authority text
    CHECK (published_authority IS NULL OR published_authority IN ('server', 'device')),
  published_at timestamptz,
  acknowledged_revision bigint,
  acknowledgement_status text
    CHECK (acknowledgement_status IS NULL OR acknowledgement_status IN ('applied', 'rejected')),
  acknowledged_at timestamptz,
  acknowledgement_reason text,
  stored_schedule_count integer
    CHECK (stored_schedule_count IS NULL OR stored_schedule_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, device_id),
  CONSTRAINT device_schedule_sync_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE CASCADE
);

CREATE TABLE spff.schedule_sync_ack_events (
  schedule_sync_ack_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id text NOT NULL,
  device_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('applied', 'rejected')),
  stored_schedule_count integer NOT NULL CHECK (stored_schedule_count >= 0),
  reason text,
  acknowledged_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL,
  CONSTRAINT schedule_sync_ack_device_fk
    FOREIGN KEY (site_id, device_id)
    REFERENCES spff.devices(site_id, device_id) ON DELETE RESTRICT,
  CONSTRAINT schedule_sync_ack_unique
    UNIQUE (site_id, device_id, revision, status, acknowledged_at)
);

CREATE INDEX schedule_sync_ack_recent_idx
  ON spff.schedule_sync_ack_events
  (site_id, device_id, received_at DESC, schedule_sync_ack_id DESC);

CREATE OR REPLACE FUNCTION spff.bump_device_schedule_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, spff
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO spff.device_schedule_sync_state (
      site_id,
      device_id,
      revision,
      updated_at
    )
    VALUES (
      OLD.site_id,
      OLD.device_id,
      1,
      clock_timestamp()
    )
    ON CONFLICT (site_id, device_id) DO UPDATE SET
      revision = spff.device_schedule_sync_state.revision + 1,
      updated_at = clock_timestamp();
  ELSIF TG_OP = 'INSERT' THEN
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
  ELSIF
    OLD.site_id IS DISTINCT FROM NEW.site_id
    OR OLD.device_id IS DISTINCT FROM NEW.device_id
    OR OLD.actuator_key IS DISTINCT FROM NEW.actuator_key
    OR OLD.on_time IS DISTINCT FROM NEW.on_time
    OR OLD.off_time IS DISTINCT FROM NEW.off_time
    OR OLD.repeat_rule IS DISTINCT FROM NEW.repeat_rule
    OR OLD.run_date IS DISTINCT FROM NEW.run_date
    OR OLD.timezone IS DISTINCT FROM NEW.timezone
    OR OLD.enabled IS DISTINCT FROM NEW.enabled
  THEN
    IF OLD.site_id IS DISTINCT FROM NEW.site_id
       OR OLD.device_id IS DISTINCT FROM NEW.device_id
    THEN
      INSERT INTO spff.device_schedule_sync_state (
        site_id,
        device_id,
        revision,
        updated_at
      )
      VALUES (
        OLD.site_id,
        OLD.device_id,
        1,
        clock_timestamp()
      )
      ON CONFLICT (site_id, device_id) DO UPDATE SET
        revision = spff.device_schedule_sync_state.revision + 1,
        updated_at = clock_timestamp();
    END IF;

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

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION spff.bump_device_schedule_revision() FROM PUBLIC;

DROP TRIGGER IF EXISTS actuator_schedules_sync_revision_trg
  ON spff.actuator_schedules;

CREATE TRIGGER actuator_schedules_sync_revision_trg
AFTER INSERT OR UPDATE OR DELETE ON spff.actuator_schedules
FOR EACH ROW
EXECUTE FUNCTION spff.bump_device_schedule_revision();

INSERT INTO spff.device_schedule_sync_state (
  site_id,
  device_id,
  revision
)
SELECT
  device.site_id,
  device.device_id,
  1
FROM spff.devices device
WHERE device.enabled = true
ON CONFLICT (site_id, device_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_api_role') THEN
    GRANT SELECT ON
      spff.device_schedule_sync_state,
      spff.schedule_sync_ack_events
    TO spff_api_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_worker_role') THEN
    GRANT SELECT ON spff.sites TO spff_worker_role;
    GRANT SELECT, UPDATE ON spff.device_schedule_sync_state
      TO spff_worker_role;
    GRANT SELECT, INSERT ON spff.schedule_sync_ack_events
      TO spff_worker_role;
    GRANT USAGE, SELECT ON SEQUENCE spff.schedule_sync_ack_events_schedule_sync_ack_id_seq
      TO spff_worker_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup_role') THEN
    GRANT SELECT ON
      spff.device_schedule_sync_state,
      spff.schedule_sync_ack_events
    TO spff_backup_role;
    GRANT SELECT ON SEQUENCE spff.schedule_sync_ack_events_schedule_sync_ack_id_seq
      TO spff_backup_role;
  END IF;
END;
$$;

COMMENT ON TABLE spff.device_schedule_sync_state IS
  'Desired schedule revision and last publish/firmware acknowledgement per device.';

COMMENT ON TABLE spff.schedule_sync_ack_events IS
  'Immutable firmware acknowledgements for retained schedule snapshots.';

COMMIT;
