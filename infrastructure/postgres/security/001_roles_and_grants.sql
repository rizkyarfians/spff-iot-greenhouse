\set ON_ERROR_STOP on

-- Jalankan sebagai role administrator PostgreSQL setelah seluruh migration selesai.
-- Script ini sengaja TIDAK membuat password/login baru agar secret tidak masuk repository.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_owner') THEN
    CREATE ROLE spff_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_api_role') THEN
    CREATE ROLE spff_api_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_worker_role') THEN
    CREATE ROLE spff_worker_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_sync_role') THEN
    CREATE ROLE spff_sync_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup_role') THEN
    CREATE ROLE spff_backup_role NOLOGIN;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA spff FROM PUBLIC;

-- Runtime app sebelumnya menjadi owner schema. Pindahkan ownership ke role NOLOGIN.
ALTER SCHEMA spff OWNER TO spff_owner;

DO $$
DECLARE obj record;
BEGIN
  FOR obj IN
    SELECT c.relkind, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'spff'
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  LOOP
    EXECUTE CASE obj.relkind
      WHEN 'S' THEN format('ALTER SEQUENCE %I.%I OWNER TO spff_owner', obj.nspname, obj.relname)
      WHEN 'v' THEN format('ALTER VIEW %I.%I OWNER TO spff_owner', obj.nspname, obj.relname)
      WHEN 'm' THEN format('ALTER MATERIALIZED VIEW %I.%I OWNER TO spff_owner', obj.nspname, obj.relname)
      ELSE format('ALTER TABLE %I.%I OWNER TO spff_owner', obj.nspname, obj.relname)
    END;
  END LOOP;
END $$;

DO $$
DECLARE obj record;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'spff'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO spff_owner', obj.signature);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA spff TO spff_api_role, spff_worker_role, spff_sync_role, spff_backup_role;

-- Local API: read dashboard data + create commands + operator actions/settings/schedules.
GRANT SELECT ON
  spff.sites,
  spff.devices,
  spff.sensor_definitions,
  spff.telemetry_samples,
  spff.latest_telemetry,
  spff.actuators,
  spff.control_commands,
  spff.command_ack_events,
  spff.actuator_state_events,
  spff.latest_actuator_states,
  spff.device_status_events,
  spff.latest_device_status,
  spff.alarms,
  spff.system_logs,
  spff.actuator_schedules,
  spff.schedule_executions,
  spff.device_schedule_sync_state,
  spff.schedule_sync_ack_events,
  spff.site_settings
TO spff_api_role;

GRANT INSERT ON spff.control_commands, spff.actuator_schedules, spff.site_settings TO spff_api_role;
GRANT UPDATE ON spff.alarms, spff.actuator_schedules, spff.site_settings TO spff_api_role;
GRANT UPDATE (name) ON spff.sites TO spff_api_role;
GRANT DELETE ON spff.actuator_schedules TO spff_api_role;

-- MQTT worker: ingestion, command lifecycle, schedule execution.
GRANT SELECT ON
  spff.sites,
  spff.devices,
  spff.actuators,
  spff.control_commands,
  spff.actuator_schedules,
  spff.schedule_executions,
  spff.device_schedule_sync_state,
  spff.schedule_sync_ack_events,
  spff.site_settings
TO spff_worker_role;
GRANT INSERT ON
  spff.telemetry_samples,
  spff.command_ack_events,
  spff.actuator_state_events,
  spff.device_status_events,
  spff.control_commands,
  spff.schedule_executions
TO spff_worker_role;
GRANT UPDATE ON spff.control_commands, spff.schedule_executions TO spff_worker_role;
GRANT UPDATE ON spff.device_schedule_sync_state TO spff_worker_role;
GRANT INSERT ON spff.schedule_sync_ack_events TO spff_worker_role;
GRANT UPDATE (firmware_version, updated_at) ON spff.devices TO spff_worker_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA spff TO spff_worker_role;

-- Sync worker hanya boleh mengonsumsi transactional outbox.
GRANT SELECT, UPDATE, DELETE ON spff.cloud_outbox TO spff_sync_role;

-- Backup role read-only untuk pg_dump.
GRANT SELECT ON ALL TABLES IN SCHEMA spff TO spff_backup_role;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA spff TO spff_backup_role;

-- Existing role dari development boleh dipakai sebagai API login setelah ownership dipindahkan.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_app') THEN
    GRANT spff_api_role TO spff_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_worker') THEN
    GRANT spff_worker_role TO spff_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_sync') THEN
    GRANT spff_sync_role TO spff_sync;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spff_backup') THEN
    GRANT spff_backup_role TO spff_backup;
  END IF;
END $$;

-- Future migrations harus dijalankan oleh spff_owner/admin, bukan runtime role.
ALTER DEFAULT PRIVILEGES FOR ROLE spff_owner IN SCHEMA spff
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE spff_owner IN SCHEMA spff
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE spff_owner IN SCHEMA spff
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
