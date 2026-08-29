import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  cropIdSchema,
  cropProfiles,
  defaultCropId,
  recommendCrops,
} from '@spff/contracts';
import type {
  ApiActuator,
  ApiActuatorLog,
  ApiAlarm,
  ApiDevice,
  ApiHistorySeries,
  ApiLatestTelemetry,
  ApiSensor,
  ApiSettings,
  ApiSystemLog,
  ApiTelemetrySnapshot,
  BootstrapData,
  HistoryBucket,
  SelectedCropInput,
  SmartSoilSnapshot,
  ScheduleRepeatRule,
} from '@spff/contracts';

const { Pool } = pg;
export const configuredSiteId = process.env.SPFF_SITE_ID ?? 'greenhouse-01';
const siteId = configuredSiteId;

const positiveNumberFromEnvironment = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
};

const deviceStaleAfterSeconds = positiveNumberFromEnvironment('DEVICE_STALE_AFTER_SECONDS', 90);
const deviceOfflineAfterSeconds = positiveNumberFromEnvironment('DEVICE_OFFLINE_AFTER_SECONDS', 300);
const telemetryStaleAfterSeconds = positiveNumberFromEnvironment('TELEMETRY_STALE_AFTER_SECONDS', 120);
const telemetryOfflineAfterSeconds = positiveNumberFromEnvironment('TELEMETRY_OFFLINE_AFTER_SECONDS', 600);

if (deviceOfflineAfterSeconds <= deviceStaleAfterSeconds) {
  throw new Error('DEVICE_OFFLINE_AFTER_SECONDS must be greater than DEVICE_STALE_AFTER_SECONDS.');
}
if (telemetryOfflineAfterSeconds <= telemetryStaleAfterSeconds) {
  throw new Error('TELEMETRY_OFFLINE_AFTER_SECONDS must be greater than TELEMETRY_STALE_AFTER_SECONDS.');
}

export const pool = new Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'spff',
  user: process.env.PGUSER ?? 'spff_app',
  password: process.env.PGPASSWORD,
  application_name: 'spff-rest-api',
  max: 8,
});

pool.on('error', (error) => {
  console.error('[postgres] pool error', error.message);
});



export type CreateScheduleInput = {
  deviceId: string;
  actuatorKey: string;
  onTime: string;
  offTime: string;
  repeatRule: ScheduleRepeatRule;
  runDate: string | null;
  requestedBy: string;
};

export type SiteSettingsInput = ApiSettings;

export type HistoryQuery = {
  from?: Date;
  to?: Date;
  hours: number;
  bucket: HistoryBucket;
  bucketMinutes: number;
};

export class ActuatorBusyError extends Error {
  constructor(public readonly commandId: string) {
    super(`Actuator still has an unfinished command (${commandId}).`);
    this.name = 'ActuatorBusyError';
  }
}

export class CommandIdConflictError extends Error {
  constructor(public readonly commandId: string) {
    super(`Command ID ${commandId} already exists with a different target or parameter.`);
    this.name = 'CommandIdConflictError';
  }
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return new Date(value).toISOString();
};

const toRequiredIso = (value: Date | string | null | undefined, field: string) => {
  const iso = toIso(value);
  if (!iso) throw new Error(`PostgreSQL returned an invalid or missing ${field}.`);
  return iso;
};

const ageSeconds = (value: Date | string | null | undefined) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
};

const durationFrom = (recordedAt: Date | string | null, active: boolean | null) => {
  if (!active || !recordedAt) return '00:00:00';
  const seconds = ageSeconds(recordedAt);
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
};

async function readiness() {
  const result = await pool.query(
    `SELECT current_database() AS database,
            to_regnamespace('spff') IS NOT NULL AS schema_ready,
            to_regclass('spff.telemetry_samples') IS NOT NULL AS telemetry_ready,
            to_regclass('spff.control_commands') IS NOT NULL AS commands_ready,
            to_regclass('spff.latest_telemetry') IS NOT NULL AS telemetry_view_ready,
            to_regclass('spff.latest_actuator_states') IS NOT NULL AS actuator_view_ready,
            to_regclass('spff.latest_device_status') IS NOT NULL AS device_view_ready,
            to_regclass('spff.actuator_schedules') IS NOT NULL AS schedules_ready,
            to_regclass('spff.device_schedule_sync_state') IS NOT NULL AS schedule_sync_ready,
            to_regclass('spff.schedule_sync_ack_events') IS NOT NULL AS schedule_sync_ack_ready,
            to_regclass('spff.site_settings') IS NOT NULL AS settings_ready,
            to_regclass('spff.cloud_outbox') IS NOT NULL AS outbox_ready,
            to_regprocedure('spff.notify_realtime_event()') IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM pg_trigger
                WHERE tgname = 'telemetry_realtime_notify_trg'
                  AND NOT tgisinternal
              )
              AND EXISTS (
                SELECT 1
                FROM pg_trigger
                WHERE tgname = 'device_status_realtime_notify_trg'
                  AND NOT tgisinternal
              )
              AND EXISTS (
                SELECT 1
                FROM pg_trigger
                WHERE tgname = 'actuator_state_realtime_notify_trg'
                  AND NOT tgisinternal
              ) AS realtime_ready`,
  );
  const row = result.rows[0];
  const checks = {
    schema: Boolean(row.schema_ready),
    telemetry: Boolean(row.telemetry_ready),
    commands: Boolean(row.commands_ready),
    latestTelemetry: Boolean(row.telemetry_view_ready),
    latestActuatorStates: Boolean(row.actuator_view_ready),
    latestDeviceStatus: Boolean(row.device_view_ready),
    schedules: Boolean(row.schedules_ready),
    scheduleSyncState: Boolean(row.schedule_sync_ready),
    scheduleSyncAcknowledgements: Boolean(row.schedule_sync_ack_ready),
    settings: Boolean(row.settings_ready),
    transactionalOutbox: Boolean(row.outbox_ready),
    realtimeNotifications: Boolean(row.realtime_ready),
  };
  return {
    ready: Object.values(checks).every(Boolean),
    database: String(row.database),
    schema: 'spff',
    checks,
  };
}

async function site() {
  const result = await pool.query(
    `SELECT site_id, name, timezone
     FROM spff.sites
     WHERE site_id = $1`,
    [siteId],
  );
  const row = result.rows[0];
  return row ? { siteId: row.site_id, name: row.name, timezone: row.timezone } : null;
}

async function sensorDefinitions() {
  const result = await pool.query(
    `SELECT sensor_key, group_name, display_name, value_type, unit, sort_order, enabled
     FROM spff.sensor_definitions
     WHERE enabled = true
     ORDER BY sort_order`,
  );
  return result.rows.map((row) => ({
    sensorKey: row.sensor_key as string,
    groupName: row.group_name as string,
    displayName: row.display_name as string,
    valueType: row.value_type as 'float' | 'integer',
    unit: row.unit as string,
    sortOrder: Number(row.sort_order),
    enabled: Boolean(row.enabled),
  }));
}

async function latestTelemetry() {
  const result = await pool.query(
    `SELECT *
     FROM spff.latest_telemetry
     WHERE site_id = $1
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [siteId],
  );
  return result.rows[0] ?? null;
}

const mapLatestTelemetry = (
  definitions: Awaited<ReturnType<typeof sensorDefinitions>>,
  latest: Record<string, unknown> | null,
): ApiLatestTelemetry | null =>
  latest
    ? {
        deviceId: latest.device_id as string,
        recordedAt: toRequiredIso(latest.recorded_at as Date | string, 'latest_telemetry.recorded_at'),
        receivedAt: toRequiredIso(latest.received_at as Date | string, 'latest_telemetry.received_at'),
        values: Object.fromEntries(
          definitions.map((definition) => [definition.sensorKey, toNumber(latest[definition.sensorKey])]),
        ),
      }
    : null;

const mapSensors = (
  definitions: Awaited<ReturnType<typeof sensorDefinitions>>,
  latest: Record<string, unknown> | null,
): ApiSensor[] => {
  const telemetryAge = ageSeconds(latest?.recorded_at as Date | string | undefined);
  return definitions.map((definition) => {
    const value = latest ? toNumber(latest[definition.sensorKey]) : null;
    const status: ApiSensor['status'] = value === null || telemetryAge >= telemetryOfflineAfterSeconds
      ? 'offline'
      : latest?.sensor_valid === false
        ? 'critical'
        : telemetryAge >= telemetryStaleAfterSeconds
          ? 'warning'
          : 'good';
    return {
      id: definition.sensorKey,
      type: definition.sensorKey,
      name: definition.displayName,
      groupName: definition.groupName,
      value,
      unit: definition.unit,
      status,
      updatedAt: toIso(latest?.recorded_at as Date | string | undefined),
    };
  });
};

async function sensors() {
  const [definitions, latest] = await Promise.all([sensorDefinitions(), latestTelemetry()]);
  return mapSensors(definitions, latest);
}

async function history(
  sensorType: string,
  query: HistoryQuery,
): Promise<ApiHistorySeries | null> {
  const sensorKey = sensorType;
  const definition = await pool.query(
    `SELECT sensor_key, unit
     FROM spff.sensor_definitions
     WHERE sensor_key = $1 AND enabled = true`,
    [sensorKey],
  );
  if (!definition.rows[0]) return null;

  const safeColumn = `"${String(definition.rows[0].sensor_key).replaceAll('"', '""')}"`;
  let rangeTo = query.to;
  if (!rangeTo) {
    const latest = await pool.query(
      `SELECT max(recorded_at) AS recorded_at
       FROM spff.telemetry_samples
       WHERE site_id = $1
         AND ${safeColumn} IS NOT NULL`,
      [siteId],
    );
    rangeTo = latest.rows[0]?.recorded_at
      ? new Date(latest.rows[0].recorded_at)
      : new Date();
  }
  const rangeFrom = query.from
    ?? new Date(rangeTo.getTime() - (query.hours * 60 * 60 * 1000));
  const result = await pool.query(
    `WITH bucketed AS (
       SELECT
         to_timestamp(
           floor(
             extract(epoch FROM recorded_at)
             / ($4::integer * 60)
           )
           * ($4::integer * 60)
         ) AS bucket_start,
         ${safeColumn}::double precision AS value
       FROM spff.telemetry_samples
       WHERE site_id = $1
         AND recorded_at >= $2::timestamptz
         AND recorded_at <= $3::timestamptz
         AND ${safeColumn} IS NOT NULL
     )
     SELECT
       bucket_start,
       round(avg(value)::numeric, 3)::double precision AS average_value,
       round(min(value)::numeric, 3)::double precision AS min_value,
       round(max(value)::numeric, 3)::double precision AS max_value,
       count(*)::integer AS samples
     FROM bucketed
     GROUP BY bucket_start
     ORDER BY bucket_start`,
    [
      siteId,
      rangeFrom.toISOString(),
      rangeTo.toISOString(),
      query.bucketMinutes,
    ],
  );

  const points = result.rows.map((row) => {
    const average = Number(row.average_value);
    return {
      time: new Date(row.bucket_start).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      }),
      value: average,
      average,
      min: Number(row.min_value),
      max: Number(row.max_value),
      samples: Number(row.samples),
      recordedAt: toRequiredIso(row.bucket_start, 'history.bucket_start'),
    };
  });

  return {
    sensorKey,
    unit: String(definition.rows[0].unit),
    from: rangeFrom.toISOString(),
    to: rangeTo.toISOString(),
    bucket: query.bucket,
    bucketMinutes: query.bucketMinutes,
    aggregate: 'avg',
    points,
  };
}

async function pumps() {
  const result = await pool.query(
    `SELECT a.device_id, a.actuator_key, a.display_name, a.actuator_type,
            a.max_runtime_seconds, a.enabled,
            state.state, state.is_active, state.recorded_at,
            command.command_id, command.status AS command_status,
            command.requested_is_active, command.issued_at AS command_issued_at
     FROM spff.actuators a
     LEFT JOIN spff.latest_actuator_states state
       ON state.site_id = a.site_id
      AND state.device_id = a.device_id
      AND state.actuator_key = a.actuator_key
     LEFT JOIN LATERAL (
       SELECT command_id, status, requested_is_active, issued_at
       FROM spff.control_commands
       WHERE site_id = a.site_id
         AND device_id = a.device_id
         AND actuator_key = a.actuator_key
       ORDER BY issued_at DESC
       LIMIT 1
     ) command ON true
     WHERE a.site_id = $1 AND a.enabled = true
     ORDER BY a.actuator_key`,
    [siteId],
  );

  return result.rows.map((row) => {
    const commandInFlight = ['pending', 'published', 'accepted'].includes(String(row.command_status));
    const reportedState = ['active', 'inactive', 'processing', 'offline', 'fault'].includes(String(row.state))
      ? String(row.state) as ApiActuator['state']
      : 'offline';
    return {
      id: row.actuator_key as string,
      deviceId: row.device_id as string,
      name: row.display_name as string,
      actuatorType: row.actuator_type as string,
      isActive: row.is_active === true,
      state: commandInFlight ? 'processing' : reportedState,
      commandId: row.command_id as string | null,
      commandStatus: row.command_status as string | null,
      requestedIsActive: commandInFlight ? Boolean(row.requested_is_active) : null,
      activeDuration: durationFrom(row.recorded_at, row.is_active),
      maxRuntimeSeconds: row.max_runtime_seconds as number | null,
      updatedAt: toIso(commandInFlight ? row.command_issued_at : row.recorded_at),
    };
  });
}

async function updatePump(actuatorKey: string, isActive: boolean, requestedBy: string, commandId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actuatorResult = await client.query(
      `SELECT a.device_id, a.display_name, a.actuator_type, a.max_runtime_seconds,
              state.is_active, state.state, state.recorded_at
       FROM spff.actuators a
       LEFT JOIN spff.latest_actuator_states state
         ON state.site_id = a.site_id
        AND state.device_id = a.device_id
        AND state.actuator_key = a.actuator_key
       WHERE a.site_id = $1 AND a.actuator_key = $2 AND a.enabled = true
       FOR UPDATE OF a`,
      [siteId, actuatorKey],
    );
    const actuator = actuatorResult.rows[0];
    if (!actuator) {
      await client.query('ROLLBACK');
      return null;
    }

    const existingCommand = await client.query(
      `SELECT command_id, site_id, device_id, actuator_key, requested_is_active,
              status, issued_at, expires_at
       FROM spff.control_commands
       WHERE command_id = $1
       FOR UPDATE`,
      [commandId],
    );
    if (existingCommand.rows[0]) {
      const existing = existingCommand.rows[0];
      if (
        existing.site_id !== siteId ||
        existing.device_id !== actuator.device_id ||
        existing.actuator_key !== actuatorKey ||
        existing.requested_is_active !== isActive
      ) {
        throw new CommandIdConflictError(commandId);
      }
      await client.query('COMMIT');
      return {
        id: actuatorKey,
        deviceId: actuator.device_id as string,
        name: actuator.display_name as string,
        actuatorType: actuator.actuator_type as string,
        isActive: actuator.is_active === true,
        state: ['pending', 'published', 'accepted'].includes(String(existing.status))
          ? 'processing'
          : (['active', 'inactive', 'processing', 'offline', 'fault'].includes(String(actuator.state))
              ? String(actuator.state) as ApiActuator['state']
              : 'offline'),
        commandId,
        commandStatus: existing.status as string,
        requestedIsActive: Boolean(existing.requested_is_active),
        activeDuration: durationFrom(actuator.recorded_at, actuator.is_active),
        maxRuntimeSeconds: actuator.max_runtime_seconds as number | null,
        updatedAt: toIso(existing.issued_at),
        expiresAt: toIso(existing.expires_at),
      };
    }

    const inFlight = await client.query(
      `SELECT command_id
       FROM spff.control_commands
       WHERE site_id = $1 AND device_id = $2 AND actuator_key = $3
         AND status IN ('pending', 'published', 'accepted')
         AND expires_at > now()
       ORDER BY issued_at DESC
       LIMIT 1`,
      [siteId, actuator.device_id, actuatorKey],
    );
    if (inFlight.rows[0]) throw new ActuatorBusyError(String(inFlight.rows[0].command_id));

    const commandResult = await client.query(
      `INSERT INTO spff.control_commands (
         command_id, site_id, device_id, actuator_key, requested_is_active,
         requested_by, issued_at, expires_at, request_payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, now(), now() + interval '30 seconds', $7)
       RETURNING status, issued_at, expires_at`,
      [
        commandId,
        siteId,
        actuator.device_id,
        actuatorKey,
        isActive,
        requestedBy,
        { source: 'spff-rest-api' },
      ],
    );
    await client.query('COMMIT');
    const command = commandResult.rows[0];
    return {
      id: actuatorKey,
      deviceId: actuator.device_id as string,
      name: actuator.display_name as string,
      actuatorType: actuator.actuator_type as string,
      isActive: actuator.is_active === true,
      state: 'processing',
      commandId,
      commandStatus: command.status as string,
      requestedIsActive: isActive,
      activeDuration: durationFrom(actuator.recorded_at, actuator.is_active),
      maxRuntimeSeconds: actuator.max_runtime_seconds as number | null,
      updatedAt: toIso(command.issued_at),
      expiresAt: toIso(command.expires_at),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function alarms(filters: {
  severity?: 'info' | 'warning' | 'critical';
  acknowledged?: boolean;
  limit?: number;
} = {}) {
  const values: unknown[] = [siteId];
  const conditions = ['site_id = $1'];
  if (filters.severity) {
    values.push(filters.severity);
    conditions.push(`severity = $${values.length}`);
  }
  if (filters.acknowledged !== undefined) {
    values.push(filters.acknowledged ? 'acknowledged' : 'open');
    conditions.push(`status = $${values.length}`);
  }
  values.push(filters.limit ?? 100);

  const result = await pool.query(
    `SELECT alarm_id, device_id, source_type, source_key, severity, status,
            title, description, triggered_at, acknowledged_at,
            acknowledged_by, resolved_at, metadata
     FROM spff.alarms
     WHERE ${conditions.join(' AND ')}
     ORDER BY triggered_at DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows.map((row) => ({
    id: String(row.alarm_id),
    deviceId: row.device_id as string,
    sourceType: row.source_type as ApiAlarm['sourceType'],
    sourceKey: row.source_key as string,
    title: row.title as string,
    description: row.description as string,
    severity: row.severity as 'info' | 'warning' | 'critical',
    status: row.status as 'open' | 'acknowledged' | 'resolved',
    acknowledged: row.status !== 'open',
    createdAt: toRequiredIso(row.triggered_at, 'alarms.triggered_at'),
    triggeredAt: toRequiredIso(row.triggered_at, 'alarms.triggered_at'),
    acknowledgedAt: toIso(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by as string | null,
    resolvedAt: toIso(row.resolved_at),
    metadata: row.metadata as Record<string, unknown> | null,
  }));
}

async function acknowledge(alarmId: string, operator = 'operator') {
  const result = await pool.query(
    `UPDATE spff.alarms
     SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $3
     WHERE alarm_id = $1 AND site_id = $2 AND status = 'open'
     RETURNING alarm_id, status, acknowledged_at, acknowledged_by`,
    [alarmId, siteId, operator],
  );
  return result.rows[0] ?? null;
}

async function resolve(alarmId: string) {
  const result = await pool.query(
    `UPDATE spff.alarms
     SET status = 'resolved', resolved_at = now()
     WHERE alarm_id = $1 AND site_id = $2 AND status <> 'resolved'
     RETURNING alarm_id, status, resolved_at`,
    [alarmId, siteId],
  );
  return result.rows[0] ?? null;
}

async function devices() {
  const result = await pool.query(
    `SELECT device.site_id, device.device_id, device.display_name,
            device.hardware_model, device.firmware_version, device.enabled,
            status.online, status.mode, status.system_state, status.growth_phase,
            status.sensor_valid, status.recorded_at
     FROM spff.devices device
     LEFT JOIN spff.latest_device_status status
       ON status.site_id = device.site_id AND status.device_id = device.device_id
     WHERE device.site_id = $1
     ORDER BY device.device_id`,
    [siteId],
  );
  return result.rows.map((row) => {
    const age = ageSeconds(row.recorded_at);
    const connectionStatus: ApiDevice['connectionStatus'] = row.online !== true || age >= deviceOfflineAfterSeconds
      ? 'offline'
      : age >= deviceStaleAfterSeconds
        ? 'stale'
        : 'online';
    return {
      siteId: row.site_id as string,
      deviceId: row.device_id as string,
      displayName: row.display_name as string,
      hardwareModel: row.hardware_model as string | null,
      firmwareVersion: row.firmware_version as string | null,
      enabled: Boolean(row.enabled),
      online: connectionStatus === 'online',
      connectionStatus,
      mode: row.mode as 'manual' | 'automatic' | null,
      systemState: row.system_state as string | null,
      growthPhase: row.growth_phase as string | null,
      sensorValid: row.sensor_valid as boolean | null,
      recordedAt: toIso(row.recorded_at),
      lastSeenSecondsAgo: Number.isFinite(age) ? age : null,
    };
  });
}

async function logs() {
  const result = await pool.query(
    `SELECT log_id, site_id, device_id, component, level, event_code,
            message, occurred_at, context
     FROM spff.system_logs
     WHERE site_id = $1 OR site_id IS NULL
     ORDER BY occurred_at DESC
     LIMIT 100`,
    [siteId],
  );
  return result.rows.map((row) => ({
    logId: String(row.log_id),
    siteId: row.site_id as string | null,
    deviceId: row.device_id as string | null,
    component: row.component as string,
    level: row.level as ApiSystemLog['level'],
    eventCode: row.event_code as string | null,
    message: row.message as string,
    occurredAt: toRequiredIso(row.occurred_at, 'system_logs.occurred_at'),
    context: row.context as Record<string, unknown> | null,
  }));
}

async function telemetryLog() {
  const result = await pool.query(
    `WITH recent AS (
       SELECT *
       FROM spff.telemetry_samples
       WHERE site_id = $1
       ORDER BY recorded_at DESC
       LIMIT 24
     )
     SELECT recent.recorded_at, definition.sensor_key,
            definition.display_name, definition.unit,
            (to_jsonb(recent) ->> definition.sensor_key)::double precision AS value
     FROM recent
     CROSS JOIN spff.sensor_definitions definition
     WHERE definition.enabled = true
       AND to_jsonb(recent) ->> definition.sensor_key IS NOT NULL
     ORDER BY recent.recorded_at DESC, definition.sort_order
     LIMIT 240`,
    [siteId],
  );
  return result.rows.map((row) => ({
    recordedAt: toRequiredIso(row.recorded_at, 'telemetry_samples.recorded_at'),
    sensorKey: row.sensor_key as string,
    displayName: row.display_name as string,
    unit: row.unit as string,
    value: toNumber(row.value),
  }));
}

async function actuatorLog(limit = 500): Promise<ApiActuatorLog[]> {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        limit,
        1_000,
      ),
    );

  const result = await pool.query(
    `SELECT event.actuator_state_id, event.device_id, event.actuator_key,
            actuator.display_name, event.state, event.is_active, event.source,
            event.reason, event.command_id, event.recorded_at, event.received_at
     FROM spff.actuator_state_events event
     JOIN spff.actuators actuator
       ON actuator.site_id = event.site_id
      AND actuator.device_id = event.device_id
      AND actuator.actuator_key = event.actuator_key
     WHERE event.site_id = $1
     ORDER BY event.recorded_at DESC, event.actuator_state_id DESC
     LIMIT $2`,
    [
      siteId,
      safeLimit,
    ],
  );

  return result.rows.map((row) => ({
    actuatorStateId: String(row.actuator_state_id),
    recordedAt: toRequiredIso(row.recorded_at, 'actuator_state_events.recorded_at'),
    receivedAt: toRequiredIso(row.received_at, 'actuator_state_events.received_at'),
    deviceId: String(row.device_id),
    actuatorKey: String(row.actuator_key),
    displayName: String(row.display_name),
    state: row.state as ApiActuatorLog['state'],
    isActive: row.is_active === null ? null : Boolean(row.is_active),
    source: row.source as ApiActuatorLog['source'],
    reason: row.reason as string | null,
    commandId: row.command_id as string | null,
  }));
}

const scheduleSelect = `
  SELECT s.schedule_id, s.site_id, s.device_id, s.actuator_key, a.display_name,
         to_char(s.on_time, 'HH24:MI') AS on_time,
         to_char(s.off_time, 'HH24:MI') AS off_time,
         s.repeat_rule, s.run_date, s.timezone, s.enabled, s.requested_by,
         s.created_at, s.updated_at
  FROM spff.actuator_schedules s
  JOIN spff.actuators a
    ON a.site_id = s.site_id AND a.device_id = s.device_id AND a.actuator_key = s.actuator_key`;

const mapSchedule = (row: Record<string, unknown>) => ({
  id: String(row.schedule_id),
  siteId: String(row.site_id),
  deviceId: String(row.device_id),
  actuatorKey: String(row.actuator_key),
  actuatorName: String(row.display_name),
  onTime: String(row.on_time),
  offTime: String(row.off_time),
  repeatRule: row.repeat_rule as ScheduleRepeatRule,
  runDate: row.run_date ? String(row.run_date).slice(0, 10) : null,
  timezone: String(row.timezone),
  enabled: Boolean(row.enabled),
  requestedBy: String(row.requested_by),
  createdAt: toIso(row.created_at as Date | string | null),
  updatedAt: toIso(row.updated_at as Date | string | null),
});

async function schedules() {
  const result = await pool.query(
    `${scheduleSelect}
     WHERE s.site_id = $1
     ORDER BY s.enabled DESC, s.on_time ASC, s.schedule_id ASC`,
    [siteId],
  );
  return result.rows.map(mapSchedule);
}

async function createSchedule(input: CreateScheduleInput) {
  const scheduleId = `schedule-${randomUUID()}`;
  const siteData = await site();
  if (!siteData) return null;
  const result = await pool.query(
    `INSERT INTO spff.actuator_schedules (
       schedule_id, site_id, device_id, actuator_key, timezone,
       on_time, off_time, repeat_rule, run_date, enabled, requested_by
     )
     SELECT $1, $2, a.device_id, a.actuator_key, $3, $4::time, $5::time, $6, $7::date, true, $8
     FROM spff.actuators a
     WHERE a.site_id = $2 AND a.device_id = $9 AND a.actuator_key = $10 AND a.enabled = true
     RETURNING schedule_id`,
    [
      scheduleId,
      siteId,
      siteData.timezone,
      input.onTime,
      input.offTime,
      input.repeatRule,
      input.runDate,
      input.requestedBy,
      input.deviceId,
      input.actuatorKey,
    ],
  );
  if (!result.rows[0]) return null;
  const created = await pool.query(`${scheduleSelect} WHERE s.schedule_id = $1`, [scheduleId]);
  return mapSchedule(created.rows[0]);
}

async function setScheduleEnabled(scheduleId: string, enabled: boolean) {
  const result = await pool.query(
    `UPDATE spff.actuator_schedules
     SET enabled = $3
     WHERE schedule_id = $1 AND site_id = $2
     RETURNING schedule_id`,
    [scheduleId, siteId, enabled],
  );
  if (!result.rows[0]) return null;
  const updated = await pool.query(`${scheduleSelect} WHERE s.schedule_id = $1`, [scheduleId]);
  return mapSchedule(updated.rows[0]);
}

async function deleteSchedule(scheduleId: string) {
  const result = await pool.query(
    `DELETE FROM spff.actuator_schedules
     WHERE schedule_id = $1 AND site_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM spff.schedule_executions execution
         WHERE execution.schedule_id = spff.actuator_schedules.schedule_id
       )
     RETURNING schedule_id`,
    [scheduleId, siteId],
  );
  return result.rows[0] ?? null;
}

async function settings() {
  const result = await pool.query(
    `SELECT site.name,
            settings.temperature_min, settings.temperature_max,
            settings.humidity_min, settings.humidity_max,
            COALESCE(settings.notifications_enabled, true) AS notifications_enabled,
            COALESCE(settings.sound_enabled, false) AS sound_enabled,
            COALESCE(settings.auto_schedule_enabled, true) AS auto_schedule_enabled
     FROM spff.sites site
     LEFT JOIN spff.site_settings settings ON settings.site_id = site.site_id
     WHERE site.site_id = $1`,
    [siteId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    greenhouseName: String(row.name),
    temperatureMin: toNumber(row.temperature_min),
    temperatureMax: toNumber(row.temperature_max),
    humidityMin: toNumber(row.humidity_min),
    humidityMax: toNumber(row.humidity_max),
    notifications: Boolean(row.notifications_enabled),
    sound: Boolean(row.sound_enabled),
    autoSchedule: Boolean(row.auto_schedule_enabled),
  };
}

async function updateSettings(input: SiteSettingsInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const siteUpdate = await client.query(
      `UPDATE spff.sites SET name = $2 WHERE site_id = $1 RETURNING site_id`,
      [siteId, input.greenhouseName],
    );
    if (!siteUpdate.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `INSERT INTO spff.site_settings (
         site_id, temperature_min, temperature_max, humidity_min, humidity_max,
         notifications_enabled, sound_enabled, auto_schedule_enabled
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (site_id) DO UPDATE SET
         temperature_min = EXCLUDED.temperature_min,
         temperature_max = EXCLUDED.temperature_max,
         humidity_min = EXCLUDED.humidity_min,
         humidity_max = EXCLUDED.humidity_max,
         notifications_enabled = EXCLUDED.notifications_enabled,
         sound_enabled = EXCLUDED.sound_enabled,
         auto_schedule_enabled = EXCLUDED.auto_schedule_enabled`,
      [
        siteId,
        input.temperatureMin,
        input.temperatureMax,
        input.humidityMin,
        input.humidityMax,
        input.notifications,
        input.sound,
        input.autoSchedule,
      ],
    );
    await client.query('COMMIT');
    return settings();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function telemetrySnapshot(): Promise<ApiTelemetrySnapshot> {
  const [
    definitions,
    latest,
    deviceData,
    telemetryRows,
    pumpData,
    actuatorRows,
  ] = await Promise.all([
    sensorDefinitions(),
    latestTelemetry(),
    devices(),
    telemetryLog(),
    pumps(),
    actuatorLog(),
  ]);

  return {
    sensors: mapSensors(definitions, latest),
    latestTelemetry: mapLatestTelemetry(definitions, latest),
    devices: deviceData,
    telemetryLog: telemetryRows,
    actuators: pumpData,
    actuatorLog: actuatorRows,
  };
}

const smartSoilZoneId = 'soil-1';
const smartSoilSensorIds = new Set([
  'air_temp',
  'air_humidity',
  'soil_1_moisture',
  'soil_1_temp',
  'soil_1_ph',
  'soil_1_ec_us_cm',
  'soil_1_n',
  'soil_1_p',
  'soil_1_k',
]);

async function smartSoil(): Promise<SmartSoilSnapshot> {
  const [sensorData, latest, deviceData, settingsData, selectionResult] = await Promise.all([
    sensors(),
    latestTelemetry(),
    devices(),
    settings(),
    pool.query(
      'SELECT crop_id FROM spff.site_crop_selections WHERE site_id = $1 AND zone_id = $2 LIMIT 1',
      [siteId, smartSoilZoneId],
    ),
  ]);

  const device = deviceData[0];
  if (!device) throw new Error('No enabled device is configured for Smart Soil.');

  const selectedCropId = cropIdSchema.catch(defaultCropId).parse(selectionResult.rows[0]?.crop_id);
  const selectedCrop = cropProfiles.find((profile) => profile.id === selectedCropId) ?? cropProfiles[0];
  const conditions = sensorData.filter((sensor) => smartSoilSensorIds.has(sensor.id));
  const value = (sensorId: string) =>
    conditions.find((sensor) => sensor.id === sensorId)?.value ?? null;

  return {
    siteId,
    zoneId: smartSoilZoneId,
    deviceId: device.deviceId,
    deviceStatus: device.connectionStatus,
    conditions: {
      sensors: conditions,
      recordedAt: toIso(latest?.recorded_at),
      sensorValid: latest?.sensor_valid === undefined ? null : Boolean(latest.sensor_valid),
    },
    humidityTarget: {
      minPercent: settingsData?.humidityMin ?? null,
      maxPercent: settingsData?.humidityMax ?? null,
    },
    profiles: [...cropProfiles],
    selectedCropId,
    selectedCrop,
    recommendations: recommendCrops({
      airTemperatureC: value('air_temp'),
      soilTemperatureC: value('soil_1_temp'),
      soilPh: value('soil_1_ph'),
      airHumidityPercent: value('air_humidity'),
      humidityMinPercent: settingsData?.humidityMin ?? null,
      humidityMaxPercent: settingsData?.humidityMax ?? null,
    }),
  };
}

async function updateSmartSoilSelection(
  input: SelectedCropInput,
  selectedBy: string,
): Promise<SmartSoilSnapshot> {
  if (input.zoneId !== smartSoilZoneId) {
    throw new Error('Smart Soil zone is not supported.');
  }
  await pool.query(
    'INSERT INTO spff.site_crop_selections (site_id, zone_id, crop_id, selected_by) VALUES ($1, $2, $3, $4) ON CONFLICT (site_id, zone_id) DO UPDATE SET crop_id = EXCLUDED.crop_id, selected_by = EXCLUDED.selected_by, selected_at = now()',
    [siteId, input.zoneId, input.selectedCropId, selectedBy],
  );
  return smartSoil();
}

async function bootstrap(): Promise<BootstrapData> {
  const [
    siteData,
    definitions,
    sensorData,
    pumpData,
    alarmData,
    deviceData,
    logData,
    telemetryRows,
    actuatorRows,
    latest,
    scheduleData,
    settingsData,
  ] = await Promise.all([
    site(),
    sensorDefinitions(),
    sensors(),
    pumps(),
    alarms(),
    devices(),
    logs(),
    telemetryLog(),
    actuatorLog(),
    latestTelemetry(),
    schedules(),
    settings(),
  ]);

  return {
    database: { database: process.env.PGDATABASE ?? 'spff', schema: 'spff' },
    site: siteData,
    sensors: sensorData,
    sensorDefinitions: definitions,
    latestTelemetry: mapLatestTelemetry(definitions, latest),
    actuators: pumpData,
    alarms: alarmData,
    devices: deviceData,
    logs: logData,
    telemetryLog: telemetryRows,
    actuatorLog: actuatorRows,
    schedules: scheduleData,
    settings: settingsData,
  };
}

async function dashboard() {
  const [siteData, sensorData, pumpData, alarmData, scheduleData] = await Promise.all([
    site(),
    sensors(),
    pumps(),
    alarms({ limit: 10 }),
    schedules(),
  ]);
  return {
    weather: {
      location: siteData?.name ?? 'Lokasi Utama',
      temperature: sensorData.find((sensor) => sensor.id === 'air_temp')?.value ?? null,
      condition: sensorData.some((sensor) => sensor.status === 'good') ? 'Terhubung' : 'Menunggu telemetry',
      date: new Date().toISOString(),
    },
    sensors: sensorData,
    pumps: pumpData,
    alarms: alarmData,
    schedules: scheduleData,
  };
}

export const repository = {
  readiness,
  bootstrap,
  dashboard,
  sensors,
  telemetrySnapshot,
  smartSoil,
  updateSmartSoilSelection,
  history,
  pumps,
  updatePump,
  alarms,
  acknowledge,
  resolve,
  devices,
  logs,
  schedules,
  createSchedule,
  setScheduleEnabled,
  deleteSchedule,
  settings,
  updateSettings,
};
