import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  compareSmartSoilReference,
  cropIdSchema,
  cropProfiles,
  defaultCropId,
  recommendCrops,
} from '@spff/contracts';
import type {
  ApiAutomaticControl,
  ApiActuator,
  ApiActuatorLog,
  ApiAlarm,
  ApiAlarmDetail,
  ApiAlarmEvent,
  ApiAlarmPage,
  ApiDevice,
  ApiHistorySeries,
  ApiLatestTelemetry,
  ApiSensor,
  ApiSettings,
  ApiSystemLog,
  ApiTelemetrySnapshot,
  AutomaticControlConfig,
  BootstrapData,
  HistoryBucket,
  SelectedCropInput,
  SmartSoilReference,
  SmartSoilReferenceInput,
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
export type AutomaticControlInput = AutomaticControlConfig;

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

export class AutomaticModeConflictError extends Error {
  constructor() {
    super('Manual ON command is blocked while automatic mode is requested.');
    this.name = 'AutomaticModeConflictError';
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
            to_regclass('spff.device_automatic_control_configs') IS NOT NULL AS automatic_control_ready,
            to_regclass('spff.automatic_control_ack_events') IS NOT NULL AS automatic_control_ack_ready,
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
    automaticControl: Boolean(row.automatic_control_ready),
    automaticControlAcknowledgements: Boolean(row.automatic_control_ack_ready),
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

    if (isActive) {
      const automaticMode = await client.query(
        `SELECT 1
         FROM spff.device_automatic_control_configs
         WHERE site_id = $1
           AND device_id = $2
           AND desired_mode = 'automatic'
         LIMIT 1`,
        [siteId, actuator.device_id],
      );
      if (automaticMode.rows[0]) throw new AutomaticModeConflictError();
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

type AlarmFilters = {
  severity?: 'info' | 'warning' | 'critical';
  status?: 'open' | 'acknowledged' | 'resolved';
  acknowledged?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
};

const alarmSelect = `
  SELECT alarm_id, device_id, rule_key, incident_key,
         source_type, source_key, severity, status,
         title, description, triggered_at, acknowledged_at,
         acknowledged_by, resolved_at, resolved_by,
         resolution_note, resolution_type, current_value,
         threshold_text, unit, first_seen_at, last_seen_at,
         occurrence_count, metadata
  FROM spff.alarms
`;

const alarmMetadataObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const mapAlarmRow = (row: Record<string, unknown>): ApiAlarm => {
  const metadata = alarmMetadataObject(row.metadata);
  const recommendation =
    typeof metadata?.recommendation === 'string'
      ? metadata.recommendation
      : null;
  return {
    id: String(row.alarm_id),
    deviceId: String(row.device_id),
    ruleKey: row.rule_key === null ? null : String(row.rule_key),
    incidentKey: row.incident_key === null ? null : String(row.incident_key),
    sourceType: row.source_type as ApiAlarm['sourceType'],
    sourceKey: String(row.source_key),
    title: String(row.title),
    description: String(row.description),
    severity: row.severity as ApiAlarm['severity'],
    status: row.status as ApiAlarm['status'],
    acknowledged: row.status !== 'open',
    createdAt: toRequiredIso(row.triggered_at as Date | string, 'alarms.triggered_at'),
    triggeredAt: toRequiredIso(row.triggered_at as Date | string, 'alarms.triggered_at'),
    acknowledgedAt: toIso(row.acknowledged_at as Date | string | null),
    acknowledgedBy: row.acknowledged_by === null ? null : String(row.acknowledged_by),
    resolvedAt: toIso(row.resolved_at as Date | string | null),
    resolvedBy: row.resolved_by === null ? null : String(row.resolved_by),
    resolutionNote: row.resolution_note === null ? null : String(row.resolution_note),
    resolutionType: row.resolution_type as ApiAlarm['resolutionType'],
    currentValue: toNumber(row.current_value),
    thresholdText: row.threshold_text === null ? null : String(row.threshold_text),
    unit: row.unit === null ? null : String(row.unit),
    firstSeenAt: toRequiredIso(row.first_seen_at as Date | string, 'alarms.first_seen_at'),
    lastSeenAt: toRequiredIso(row.last_seen_at as Date | string, 'alarms.last_seen_at'),
    occurrenceCount: Number(row.occurrence_count),
    recommendation,
    metadata,
  };
};

const alarmConditions = (
  filters: AlarmFilters,
  values: unknown[],
): string[] => {
  const conditions = ['site_id = $1'];
  if (filters.severity) {
    values.push(filters.severity);
    conditions.push('severity = $' + values.length);
  }
  const status =
    filters.status ??
    (filters.acknowledged === undefined
      ? undefined
      : filters.acknowledged ? 'acknowledged' : 'open');
  if (status) {
    values.push(status);
    conditions.push('status = $' + values.length);
  }
  const search = filters.query?.trim();
  if (search) {
    values.push('%' + search + '%');
    const placeholder = '$' + values.length;
    conditions.push(
      '(title ILIKE ' + placeholder +
      ' OR source_key ILIKE ' + placeholder +
      ' OR device_id ILIKE ' + placeholder +
      ' OR alarm_id::text ILIKE ' + placeholder + ')',
    );
  }
  return conditions;
};

async function alarms(filters: AlarmFilters = {}): Promise<ApiAlarm[]> {
  const values: unknown[] = [siteId];
  const conditions = alarmConditions(filters, values);
  values.push(Math.max(1, Math.min(filters.limit ?? 100, 100)));
  const limitPlaceholder = '$' + values.length;
  const offset = Math.max(0, filters.offset ?? 0);
  values.push(offset);
  const offsetPlaceholder = '$' + values.length;
  const result = await pool.query(
    alarmSelect +
      ' WHERE ' + conditions.join(' AND ') +
      ' ORDER BY last_seen_at DESC, alarm_id DESC' +
      ' LIMIT ' + limitPlaceholder +
      ' OFFSET ' + offsetPlaceholder,
    values,
  );
  return result.rows.map((row) => mapAlarmRow(row));
}

async function alarmPage(filters: {
  severity?: ApiAlarm['severity'];
  status?: ApiAlarm['status'];
  query?: string;
  page: number;
  pageSize: number;
}): Promise<ApiAlarmPage> {
  const values: unknown[] = [siteId];
  const conditions = alarmConditions(filters, values);
  const countResult = await pool.query(
    'SELECT count(*)::integer AS total FROM spff.alarms WHERE ' +
      conditions.join(' AND '),
    values,
  );
  const totalItems = Number(countResult.rows[0]?.total ?? 0);
  const items = await alarms({
    ...filters,
    limit: filters.pageSize,
    offset: (filters.page - 1) * filters.pageSize,
  });
  const countsResult = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'open')::integer AS open,
       count(*) FILTER (WHERE status = 'acknowledged')::integer AS acknowledged,
       count(*) FILTER (WHERE status = 'resolved')::integer AS resolved,
       count(*) FILTER (
         WHERE status <> 'resolved' AND severity = 'critical'
       )::integer AS critical_active
     FROM spff.alarms
     WHERE site_id = $1`,
    [siteId],
  );
  const counts = countsResult.rows[0] ?? {};
  return {
    items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / filters.pageSize)),
    },
    counts: {
      open: Number(counts.open ?? 0),
      acknowledged: Number(counts.acknowledged ?? 0),
      resolved: Number(counts.resolved ?? 0),
      criticalActive: Number(counts.critical_active ?? 0),
    },
  };
}

async function alarmDetail(alarmId: string): Promise<ApiAlarmDetail | null> {
  const alarmResult = await pool.query(
    alarmSelect + ' WHERE site_id = $1 AND alarm_id = $2 LIMIT 1',
    [siteId, alarmId],
  );
  if (!alarmResult.rows[0]) return null;
  const eventResult = await pool.query(
    `SELECT alarm_event_id, alarm_id, event_type, from_status, to_status,
            severity, current_value, threshold_text, actor, note,
            occurred_at, metadata
     FROM spff.alarm_events
     WHERE alarm_id = $1
     ORDER BY occurred_at ASC, alarm_event_id ASC`,
    [alarmId],
  );
  const events: ApiAlarmEvent[] = eventResult.rows.map((row) => ({
    id: String(row.alarm_event_id),
    alarmId: String(row.alarm_id),
    eventType: row.event_type as ApiAlarmEvent['eventType'],
    fromStatus: row.from_status as ApiAlarmEvent['fromStatus'],
    toStatus: row.to_status as ApiAlarmEvent['toStatus'],
    severity: row.severity as ApiAlarmEvent['severity'],
    value: toNumber(row.current_value),
    thresholdText: row.threshold_text === null ? null : String(row.threshold_text),
    actor: row.actor === null ? null : String(row.actor),
    note: row.note === null ? null : String(row.note),
    occurredAt: toRequiredIso(row.occurred_at, 'alarm_events.occurred_at'),
    metadata: alarmMetadataObject(row.metadata),
  }));
  return { ...mapAlarmRow(alarmResult.rows[0]), events };
}

async function acknowledge(
  alarmId: string,
  operator = 'operator',
  note: string | null = null,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE spff.alarms
       SET status = 'acknowledged',
           acknowledged_at = now(),
           acknowledged_by = $3,
           updated_at = now()
       WHERE alarm_id = $1 AND site_id = $2 AND status = 'open'
       RETURNING alarm_id, severity, current_value, threshold_text,
                 acknowledged_at, acknowledged_by`,
      [alarmId, siteId, operator],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `INSERT INTO spff.alarm_events (
         alarm_id, event_type, from_status, to_status, severity,
         current_value, threshold_text, actor, note, occurred_at
       ) VALUES (
         $1, 'acknowledged', 'open', 'acknowledged', $2,
         $3, $4, $5, $6, $7
       )`,
      [
        alarmId,
        row.severity,
        row.current_value,
        row.threshold_text,
        operator,
        note,
        row.acknowledged_at,
      ],
    );
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolve(
  alarmId: string,
  operator = 'admin',
  note: string | null = null,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query(
      `SELECT status, severity, current_value, threshold_text
       FROM spff.alarms
       WHERE alarm_id = $1 AND site_id = $2 AND status <> 'resolved'
       FOR UPDATE`,
      [alarmId, siteId],
    );
    if (!previous.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const result = await client.query(
      `UPDATE spff.alarms
       SET status = 'resolved',
           resolved_at = now(),
           resolved_by = $3,
           resolution_note = $4,
           resolution_type = 'manual',
           updated_at = now()
       WHERE alarm_id = $1 AND site_id = $2
       RETURNING alarm_id, status, resolved_at, resolved_by,
                 resolution_note, resolution_type`,
      [alarmId, siteId, operator, note],
    );
    await client.query(
      `INSERT INTO spff.alarm_events (
         alarm_id, event_type, from_status, to_status, severity,
         current_value, threshold_text, actor, note, occurred_at
       ) VALUES (
         $1, 'resolved', $2, 'resolved', $3,
         $4, $5, $6, $7, now()
       )`,
      [
        alarmId,
        previous.rows[0].status,
        previous.rows[0].severity,
        previous.rows[0].current_value,
        previous.rows[0].threshold_text,
        operator,
        note,
      ],
    );
    await client.query(
      `UPDATE spff.alarm_rule_states
       SET active_alarm_id = NULL,
           violation_count = 0,
           recovery_count = 0,
           updated_at = now()
       WHERE active_alarm_id = $1`,
      [alarmId],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

const automaticControlSelect = `
  SELECT config.*,
         status.mode AS actual_mode
  FROM spff.device_automatic_control_configs config
  LEFT JOIN spff.latest_device_status status
    ON status.site_id = config.site_id
   AND status.device_id = config.device_id
`;

const mapAutomaticControl = (row: Record<string, unknown>): ApiAutomaticControl => ({
  siteId: String(row.site_id),
  deviceId: String(row.device_id),
  revision: Number(row.revision),
  desiredMode: row.desired_mode as ApiAutomaticControl['desiredMode'],
  actualMode: (row.actual_mode ?? null) as ApiAutomaticControl['actualMode'],
  water: {
    enabled: Boolean(row.water_enabled),
    sensorKey: row.water_sensor_key as ApiAutomaticControl['water']['sensorKey'],
    moistureLowPercent: toNumber(row.water_moisture_low_pct),
    moistureTargetPercent: toNumber(row.water_moisture_target_pct),
    maxRuntimeSeconds: toNumber(row.water_max_runtime_seconds),
    cooldownSeconds: toNumber(row.water_cooldown_seconds),
    minTankLevelPercent: toNumber(row.water_min_tank_level_pct),
    minFlowLpm: toNumber(row.water_min_flow_lpm),
    triggerSampleCount: Number(row.water_trigger_sample_count),
    sensorStaleSeconds: Number(row.water_sensor_stale_seconds),
  },
  fertilizer: {
    enabled: Boolean(row.fertilizer_enabled),
    sensorKey: 'liquid_ec_us_cm',
    ecLowUsCm: toNumber(row.fertilizer_ec_low_us_cm),
    ecTargetUsCm: toNumber(row.fertilizer_ec_target_us_cm),
    ecHighUsCm: toNumber(row.fertilizer_ec_high_us_cm),
    dosePulseSeconds: toNumber(row.fertilizer_dose_pulse_seconds),
    mixingDelaySeconds: toNumber(row.fertilizer_mixing_delay_seconds),
    cooldownSeconds: toNumber(row.fertilizer_cooldown_seconds),
    maxDoseVolumeL: toNumber(row.fertilizer_max_dose_volume_l),
    maxDailyVolumeL: toNumber(row.fertilizer_max_daily_volume_l),
    minTankLevelPercent: toNumber(row.fertilizer_min_tank_level_pct),
    minFlowLpm: toNumber(row.fertilizer_min_flow_lpm),
    triggerSampleCount: Number(row.fertilizer_trigger_sample_count),
    sensorStaleSeconds: Number(row.fertilizer_sensor_stale_seconds),
  },
  publishedRevision: toNumber(row.published_revision),
  publishedAt: toIso(row.published_at as Date | string | null),
  acknowledgedRevision: toNumber(row.acknowledged_revision),
  acknowledgementStatus: (row.acknowledgement_status ?? null) as ApiAutomaticControl['acknowledgementStatus'],
  acknowledgedAt: toIso(row.acknowledged_at as Date | string | null),
  acknowledgementReason: (row.acknowledgement_reason ?? null) as string | null,
  appliedMode: (row.applied_mode ?? null) as ApiAutomaticControl['appliedMode'],
  updatedBy: String(row.updated_by),
  updatedAt: toRequiredIso(row.updated_at as Date | string, 'automatic control updated_at'),
});

async function automaticControl(): Promise<ApiAutomaticControl | null> {
  const result = await pool.query(
    `${automaticControlSelect}
     WHERE config.site_id = $1
     ORDER BY config.device_id
     LIMIT 1`,
    [siteId],
  );
  return result.rows[0] ? mapAutomaticControl(result.rows[0]) : null;
}

async function updateAutomaticControl(
  input: AutomaticControlInput,
  updatedBy: string,
): Promise<ApiAutomaticControl | null> {
  const deviceResult = await pool.query(
    `SELECT device_id
     FROM spff.devices
     WHERE site_id = $1 AND enabled = true
     ORDER BY device_id
     LIMIT 1`,
    [siteId],
  );
  const deviceId = deviceResult.rows[0]?.device_id as string | undefined;
  if (!deviceId) return null;

  await pool.query(
    `INSERT INTO spff.device_automatic_control_configs (
       site_id, device_id, desired_mode,
       water_enabled, water_sensor_key, water_moisture_low_pct,
       water_moisture_target_pct, water_max_runtime_seconds,
       water_cooldown_seconds, water_min_tank_level_pct,
       water_min_flow_lpm, water_trigger_sample_count,
       water_sensor_stale_seconds,
       fertilizer_enabled, fertilizer_sensor_key,
       fertilizer_ec_low_us_cm, fertilizer_ec_target_us_cm,
       fertilizer_ec_high_us_cm, fertilizer_dose_pulse_seconds,
       fertilizer_mixing_delay_seconds, fertilizer_cooldown_seconds,
       fertilizer_max_dose_volume_l, fertilizer_max_daily_volume_l,
       fertilizer_min_tank_level_pct, fertilizer_min_flow_lpm,
       fertilizer_trigger_sample_count, fertilizer_sensor_stale_seconds,
       updated_by
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
       $24, $25, $26, $27, $28
     )
     ON CONFLICT (site_id, device_id) DO UPDATE SET
       revision = spff.device_automatic_control_configs.revision + 1,
       desired_mode = EXCLUDED.desired_mode,
       water_enabled = EXCLUDED.water_enabled,
       water_sensor_key = EXCLUDED.water_sensor_key,
       water_moisture_low_pct = EXCLUDED.water_moisture_low_pct,
       water_moisture_target_pct = EXCLUDED.water_moisture_target_pct,
       water_max_runtime_seconds = EXCLUDED.water_max_runtime_seconds,
       water_cooldown_seconds = EXCLUDED.water_cooldown_seconds,
       water_min_tank_level_pct = EXCLUDED.water_min_tank_level_pct,
       water_min_flow_lpm = EXCLUDED.water_min_flow_lpm,
       water_trigger_sample_count = EXCLUDED.water_trigger_sample_count,
       water_sensor_stale_seconds = EXCLUDED.water_sensor_stale_seconds,
       fertilizer_enabled = EXCLUDED.fertilizer_enabled,
       fertilizer_sensor_key = EXCLUDED.fertilizer_sensor_key,
       fertilizer_ec_low_us_cm = EXCLUDED.fertilizer_ec_low_us_cm,
       fertilizer_ec_target_us_cm = EXCLUDED.fertilizer_ec_target_us_cm,
       fertilizer_ec_high_us_cm = EXCLUDED.fertilizer_ec_high_us_cm,
       fertilizer_dose_pulse_seconds = EXCLUDED.fertilizer_dose_pulse_seconds,
       fertilizer_mixing_delay_seconds = EXCLUDED.fertilizer_mixing_delay_seconds,
       fertilizer_cooldown_seconds = EXCLUDED.fertilizer_cooldown_seconds,
       fertilizer_max_dose_volume_l = EXCLUDED.fertilizer_max_dose_volume_l,
       fertilizer_max_daily_volume_l = EXCLUDED.fertilizer_max_daily_volume_l,
       fertilizer_min_tank_level_pct = EXCLUDED.fertilizer_min_tank_level_pct,
       fertilizer_min_flow_lpm = EXCLUDED.fertilizer_min_flow_lpm,
       fertilizer_trigger_sample_count = EXCLUDED.fertilizer_trigger_sample_count,
       fertilizer_sensor_stale_seconds = EXCLUDED.fertilizer_sensor_stale_seconds,
       published_revision = NULL,
       published_at = NULL,
       acknowledged_revision = NULL,
       acknowledgement_status = NULL,
       acknowledged_at = NULL,
       acknowledgement_reason = NULL,
       updated_by = EXCLUDED.updated_by`,
    [
      siteId, deviceId, input.desiredMode,
      input.water.enabled, input.water.sensorKey,
      input.water.moistureLowPercent, input.water.moistureTargetPercent,
      input.water.maxRuntimeSeconds, input.water.cooldownSeconds,
      input.water.minTankLevelPercent, input.water.minFlowLpm,
      input.water.triggerSampleCount, input.water.sensorStaleSeconds,
      input.fertilizer.enabled, input.fertilizer.sensorKey,
      input.fertilizer.ecLowUsCm, input.fertilizer.ecTargetUsCm,
      input.fertilizer.ecHighUsCm, input.fertilizer.dosePulseSeconds,
      input.fertilizer.mixingDelaySeconds, input.fertilizer.cooldownSeconds,
      input.fertilizer.maxDoseVolumeL, input.fertilizer.maxDailyVolumeL,
      input.fertilizer.minTankLevelPercent, input.fertilizer.minFlowLpm,
      input.fertilizer.triggerSampleCount, input.fertilizer.sensorStaleSeconds,
      updatedBy,
    ],
  );
  return automaticControl();
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
  const [sensorData, latest, deviceData, settingsData, selectionResult, referenceResult] = await Promise.all([
    sensors(),
    latestTelemetry(),
    devices(),
    settings(),
    pool.query(
      'SELECT crop_id FROM spff.site_crop_selections WHERE site_id = $1 AND zone_id = $2 LIMIT 1',
      [siteId, smartSoilZoneId],
    ),
    pool.query(
      `SELECT zone_id, crop_name, temperature_min_c, temperature_max_c,
              soil_ph_min, soil_ph_max, humidity_min_percent, humidity_max_percent,
              updated_by, updated_at
       FROM spff.site_smart_soil_references
       WHERE site_id = $1 AND zone_id = $2
       LIMIT 1`,
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
  const referenceRow = referenceResult.rows[0];
  const reference: SmartSoilReference | null = referenceRow
    ? {
        zoneId: String(referenceRow.zone_id),
        cropName: String(referenceRow.crop_name),
        temperatureMinC: Number(referenceRow.temperature_min_c),
        temperatureMaxC: Number(referenceRow.temperature_max_c),
        soilPhMin: Number(referenceRow.soil_ph_min),
        soilPhMax: Number(referenceRow.soil_ph_max),
        humidityMinPercent: Number(referenceRow.humidity_min_percent),
        humidityMaxPercent: Number(referenceRow.humidity_max_percent),
        updatedBy: String(referenceRow.updated_by),
        updatedAt: toRequiredIso(referenceRow.updated_at, 'smart soil reference updated_at'),
      }
    : null;

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
    reference,
    comparison: reference
      ? compareSmartSoilReference(reference, {
          airTemperatureC: value('air_temp'),
          soilPh: value('soil_1_ph'),
          airHumidityPercent: value('air_humidity'),
        })
      : [],
  };
}

async function updateSmartSoilReference(
  input: SmartSoilReferenceInput,
  updatedBy: string,
): Promise<SmartSoilSnapshot> {
  if (input.zoneId !== smartSoilZoneId) {
    throw new Error('Smart Soil zone is not supported.');
  }
  await pool.query(
    `INSERT INTO spff.site_smart_soil_references (
       site_id, zone_id, crop_name,
       temperature_min_c, temperature_max_c,
       soil_ph_min, soil_ph_max,
       humidity_min_percent, humidity_max_percent,
       updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (site_id, zone_id) DO UPDATE SET
       crop_name = EXCLUDED.crop_name,
       temperature_min_c = EXCLUDED.temperature_min_c,
       temperature_max_c = EXCLUDED.temperature_max_c,
       soil_ph_min = EXCLUDED.soil_ph_min,
       soil_ph_max = EXCLUDED.soil_ph_max,
       humidity_min_percent = EXCLUDED.humidity_min_percent,
       humidity_max_percent = EXCLUDED.humidity_max_percent,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      siteId,
      input.zoneId,
      input.cropName,
      input.temperatureMinC,
      input.temperatureMaxC,
      input.soilPhMin,
      input.soilPhMax,
      input.humidityMinPercent,
      input.humidityMaxPercent,
      updatedBy,
    ],
  );
  return smartSoil();
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
    automaticControlData,
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
    automaticControl(),
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
    automaticControl: automaticControlData,
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
  updateSmartSoilReference,
  history,
  pumps,
  updatePump,
  alarms,
  alarmPage,
  alarmDetail,
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
  automaticControl,
  updateAutomaticControl,
};
