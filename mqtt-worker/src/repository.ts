import type {
  ActuatorStateMessage,
  CommandAckMessage,
  DeviceStatusMessage,
  ScheduleExecutionAuthority,
  ScheduleSyncAckMessage,
  ScheduleSyncMessage,
  TelemetryMessage,
} from "@spff/contracts";
import { Pool, type PoolClient } from "pg";
import { config } from "./config.js";
import type {
  AlarmCommandSubject,
  AlarmHealthSubject,
  AlarmObservation,
  AlarmRepository,
  AlarmRule,
} from "./alarmEvaluator.js";

export interface IngestionRepository {
  saveTelemetry(message: TelemetryMessage): Promise<void>;
  saveAcknowledgement(message: CommandAckMessage): Promise<void>;
  saveScheduleSyncAck(message: ScheduleSyncAckMessage): Promise<void>;
  saveActuatorState(message: ActuatorStateMessage): Promise<void>;
  saveDeviceStatus(message: DeviceStatusMessage): Promise<void>;
}

export interface PendingControlCommand {
  commandId: string;
  siteId: string;
  deviceId: string;
  actuatorKey: string;
  requestedIsActive: boolean;
  requestedBy: string;
  issuedAt: string;
  expiresAt: string;
}

export interface CommandDispatchRepository {
  expireCommands(): Promise<number>;
  pendingCommands(limit: number): Promise<PendingControlCommand[]>;
  markCommandPublished(commandId: string, publishedAt: string): Promise<void>;
}

export type ScheduleRepeatRule = "daily" | "weekdays" | "weekends" | "once";
export type ScheduleAction = "on" | "off";

export interface ActuatorSchedule {
  scheduleId: string;
  siteId: string;
  deviceId: string;
  actuatorKey: string;
  enabled: boolean;
  repeatRule: ScheduleRepeatRule;
  onTime: string;
  offTime: string | null;
  durationSeconds: number | null;
  onceDate: string | null;
  timezone: string;
}

export interface ScheduledCommandRequest {
  commandId: string;
  scheduleId: string;
  siteId: string;
  deviceId: string;
  actuatorKey: string;
  action: ScheduleAction;
  requestedIsActive: boolean;
  scheduledFor: string;
  issuedAt: string;
  expiresAt: string;
  repeatRule: ScheduleRepeatRule;
  timezone: string;
}

export interface ScheduleRepository {
  enabledSchedules(): Promise<ActuatorSchedule[]>;
  createScheduledCommand(request: ScheduledCommandRequest): Promise<boolean>;
}

export interface ScheduleSyncRepository {
  scheduleSnapshots(
    authority: ScheduleExecutionAuthority,
    force: boolean,
  ): Promise<ScheduleSyncMessage[]>;
  markSchedulePublished(
    siteId: string,
    deviceId: string,
    revision: number,
    authority: ScheduleExecutionAuthority,
    publishedAt: string,
  ): Promise<void>;
}

type JsonObject = Record<string, unknown>;

type AckStatus = "accepted" | "completed" | "rejected" | "timed_out";

const asObject = (value: unknown): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
};

const optionalNumber = (source: JsonObject, key: string): number | null => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const optionalBoolean = (source: JsonObject, key: string): boolean | null => {
  const value = source[key];
  return typeof value === "boolean" ? value : null;
};

const optionalString = (source: JsonObject, key: string): string | null => {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const firstString = (source: JsonObject, keys: string[]): string | null => {
  for (const key of keys) {
    const value = optionalString(source, key);
    if (value) return value;
  }
  return null;
};

const firstScalarString = (source: JsonObject, keys: string[]): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const firstNumber = (source: JsonObject, keys: string[]): number | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const normalizeScheduleTime = (value: string | null): string | null => {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
};

const normalizeRepeatRule = (value: string | null): ScheduleRepeatRule | null => {
  const normalized = value?.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (normalized === "daily" || normalized === "everyday" || normalized === "setiap_hari") return "daily";
  if (normalized === "weekdays" || normalized === "weekday" || normalized === "senin_jumat") return "weekdays";
  if (normalized === "weekends" || normalized === "weekend" || normalized === "akhir_pekan") return "weekends";
  if (normalized === "once" || normalized === "one_time" || normalized === "single") return "once";
  return null;
};

const normalizeDateOnly = (value: string | null): string | null => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
};

const isValidTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const firstBoolean = (source: JsonObject, keys: string[]): boolean | null => {
  for (const key of keys) {
    const value = optionalBoolean(source, key);
    if (value !== null) return value;
  }
  return null;
};

const firstObject = (source: JsonObject, keys: string[]): JsonObject => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as JsonObject;
    }
  }
  return {};
};

const requiredTimestamp = (
  source: JsonObject,
  keys: string[],
  description: string,
): string => {
  const value = firstString(source, keys);
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${description} must be a valid ISO 8601 timestamp.`);
  }
  return value;
};

const asAckStatus = (value: string): AckStatus => {
  if (
    value === "accepted" ||
    value === "completed" ||
    value === "rejected" ||
    value === "timed_out"
  ) {
    return value;
  }
  throw new Error(`Unsupported command acknowledgement status: ${value}.`);
};

export type DatabasePool = Pick<Pool, "query" | "connect" | "end">;

export class PostgresIngestionRepository implements IngestionRepository, CommandDispatchRepository, ScheduleRepository, AlarmRepository {
  private readonly pool: DatabasePool;

  constructor(
    pool: DatabasePool = new Pool({
      connectionString: config.database.url,
      max: config.database.maxConnections,
      connectionTimeoutMillis: config.database.connectionTimeoutMs,
      idleTimeoutMillis: config.database.idleTimeoutMs,
    }),
  ) {
    this.pool = pool;
  }

  async checkConnection(): Promise<void> {
    await this.pool.query("SELECT 1");
    console.log("[repository] PostgreSQL connected.");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }


  async expireCommands(): Promise<number> {
    const result = await this.pool.query(
      `
        UPDATE spff.control_commands
        SET
          status = 'timed_out',
          completed_at = COALESCE(completed_at, now()),
          reason = COALESCE(reason, 'command_expired'),
          updated_at = now()
        WHERE status IN ('pending', 'published', 'accepted')
          AND expires_at <= now()
      `,
    );
    return result.rowCount ?? 0;
  }

  async pendingCommands(limit: number): Promise<PendingControlCommand[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const result = await this.pool.query<{
      command_id: string;
      site_id: string;
      device_id: string;
      actuator_key: string;
      requested_is_active: boolean;
      requested_by: string;
      issued_at: Date | string;
      expires_at: Date | string;
    }>(
      `
        SELECT
          command_id,
          site_id,
          device_id,
          actuator_key,
          requested_is_active,
          requested_by,
          issued_at,
          expires_at
        FROM spff.control_commands
        WHERE status = 'pending'
          AND issued_at <= now()
          AND expires_at > now()
        ORDER BY issued_at ASC, created_at ASC
        LIMIT $1
      `,
      [safeLimit],
    );

    const iso = (value: Date | string) =>
      value instanceof Date ? value.toISOString() : new Date(value).toISOString();

    return result.rows.map((row) => ({
      commandId: row.command_id,
      siteId: row.site_id,
      deviceId: row.device_id,
      actuatorKey: row.actuator_key,
      requestedIsActive: row.requested_is_active,
      requestedBy: row.requested_by,
      issuedAt: iso(row.issued_at),
      expiresAt: iso(row.expires_at),
    }));
  }

  async markCommandPublished(
    commandId: string,
    publishedAt: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `
        UPDATE spff.control_commands
        SET
          status = 'published',
          published_at = COALESCE(published_at, $2::timestamptz),
          updated_at = now()
        WHERE command_id = $1
          AND status = 'pending'
          AND expires_at > now()
      `,
      [commandId, publishedAt],
    );

    if ((result.rowCount ?? 0) === 0) {
      console.warn("[repository] command was not marked published", {
        commandId,
      });
    }
  }

  async enabledSchedules(): Promise<ActuatorSchedule[]> {
    const [scheduleResult, actuatorResult, siteResult] = await Promise.all([
      this.pool.query<{ schedule: JsonObject }>(
        `SELECT to_jsonb(s) AS schedule FROM spff.actuator_schedules s`,
      ),
      this.pool.query<{
        site_id: string;
        device_id: string;
        actuator_key: string;
      }>(
        `
          SELECT site_id, device_id, actuator_key
          FROM spff.actuators
          WHERE enabled = true
        `,
      ),
      this.pool.query<{ site_id: string; timezone: string }>(
        `SELECT site_id, timezone FROM spff.sites`,
      ),
    ]);

    const timezoneBySite = new Map(
      siteResult.rows.map((row) => [row.site_id, row.timezone]),
    );
    const schedules: ActuatorSchedule[] = [];

    for (const row of scheduleResult.rows) {
      const raw = asObject(row.schedule);
      const enabled = firstBoolean(raw, ["enabled", "is_enabled", "isEnabled"]);
      if (enabled === false) continue;

      const scheduleId = firstScalarString(raw, ["schedule_id", "scheduleId", "id"]);
      const actuatorKey = firstString(raw, [
        "actuator_key",
        "actuatorKey",
        "target_id",
        "targetId",
      ]);
      if (!scheduleId || !actuatorKey) {
        console.warn("[repository] schedule skipped: missing identity", { raw });
        continue;
      }

      const requestedSiteId = firstString(raw, ["site_id", "siteId"]);
      const requestedDeviceId = firstString(raw, ["device_id", "deviceId"]);
      const candidates = actuatorResult.rows.filter(
        (actuator) =>
          actuator.actuator_key === actuatorKey &&
          (!requestedSiteId || actuator.site_id === requestedSiteId) &&
          (!requestedDeviceId || actuator.device_id === requestedDeviceId),
      );

      if (candidates.length !== 1) {
        console.warn("[repository] schedule skipped: actuator identity is ambiguous or missing", {
          scheduleId,
          actuatorKey,
          siteId: requestedSiteId,
          deviceId: requestedDeviceId,
          matches: candidates.length,
        });
        continue;
      }

      const actuator = candidates[0];
      if (!actuator) continue;

      const repeatRule = normalizeRepeatRule(
        firstString(raw, [
          "repeat_rule",
          "repeatRule",
          "repeat_type",
          "repeatType",
          "recurrence",
          "repeat",
        ]),
      );
      const onTime = normalizeScheduleTime(
        firstString(raw, [
          "on_time",
          "onTime",
          "start_time",
          "startTime",
          "time",
        ]),
      );
      const offTime = normalizeScheduleTime(
        firstString(raw, ["off_time", "offTime", "end_time", "endTime"]),
      );
      const durationSecondsValue = firstNumber(raw, [
        "duration_seconds",
        "durationSeconds",
      ]);
      const durationMinutesValue = firstNumber(raw, [
        "duration_minutes",
        "durationMinutes",
        "duration_min",
      ]);
      const durationSeconds =
        durationSecondsValue !== null && durationSecondsValue > 0
          ? Math.round(durationSecondsValue)
          : durationMinutesValue !== null && durationMinutesValue > 0
            ? Math.round(durationMinutesValue * 60)
            : null;
      const onceDate = normalizeDateOnly(
        firstString(raw, [
          "once_date",
          "onceDate",
          "scheduled_date",
          "scheduledDate",
          "run_date",
          "runDate",
          "date",
        ]),
      );
      const timezoneCandidate =
        firstString(raw, ["timezone", "time_zone", "timeZone"]) ??
        timezoneBySite.get(actuator.site_id) ??
        "Asia/Jakarta";

      if (!repeatRule || !onTime) {
        console.warn("[repository] schedule skipped: repeat rule/on time is invalid", {
          scheduleId,
          repeatRule: firstString(raw, ["repeat_rule", "repeatRule", "recurrence", "repeat"]),
          onTime: firstString(raw, ["on_time", "onTime", "start_time", "startTime", "time"]),
        });
        continue;
      }
      if (repeatRule === "once" && !onceDate) {
        console.warn("[repository] one-time schedule skipped: date is missing", {
          scheduleId,
        });
        continue;
      }
      if (!isValidTimezone(timezoneCandidate)) {
        console.warn("[repository] schedule skipped: invalid timezone", {
          scheduleId,
          timezone: timezoneCandidate,
        });
        continue;
      }

      schedules.push({
        scheduleId,
        siteId: actuator.site_id,
        deviceId: actuator.device_id,
        actuatorKey,
        enabled: enabled ?? true,
        repeatRule,
        onTime,
        offTime,
        durationSeconds,
        onceDate,
        timezone: timezoneCandidate,
      });
    }

    return schedules;
  }

  async scheduleSnapshots(
    authority: ScheduleExecutionAuthority,
    force: boolean,
  ): Promise<ScheduleSyncMessage[]> {
    const [syncResult, schedules] = await Promise.all([
      this.pool.query<{
        site_id: string;
        device_id: string;
        revision: string | number;
      }>(
        `
          WITH authority_revision AS (
            UPDATE spff.device_schedule_sync_state
            SET
              revision = revision + 1,
              updated_at = now()
            WHERE published_revision = revision
              AND published_authority IS NOT NULL
              AND published_authority IS DISTINCT FROM $1
            RETURNING site_id, device_id
          )
          SELECT site_id, device_id, revision
          FROM spff.device_schedule_sync_state
          WHERE $2::boolean
             OR published_revision IS DISTINCT FROM revision
             OR published_authority IS DISTINCT FROM $1
          ORDER BY site_id, device_id
        `,
        [
          authority,
          force,
        ],
      ),
      this.enabledSchedules(),
    ]);

    const generatedAt = new Date().toISOString();

    return syncResult.rows.map((sync) => {
      const deviceSchedules = schedules
        .filter(
          (schedule) =>
            schedule.siteId === sync.site_id &&
            schedule.deviceId === sync.device_id &&
            schedule.enabled &&
            schedule.offTime !== null,
        )
        .map((schedule) => ({
          scheduleId: schedule.scheduleId,
          targetId: schedule.actuatorKey,
          onTime: schedule.onTime,
          offTime: schedule.offTime as string,
          repeatRule: schedule.repeatRule,
          runDate: schedule.onceDate,
          timezone: schedule.timezone,
          enabled: true,
        }));

      if (deviceSchedules.length > 64) {
        throw new Error(
          `Device ${sync.site_id}/${sync.device_id} has ${deviceSchedules.length} enabled schedules; maximum is 64.`,
        );
      }

      return {
        kind: "schedule_sync",
        schemaVersion: 1,
        siteId: sync.site_id,
        deviceId: sync.device_id,
        revision: Number(sync.revision),
        generatedAt,
        executionAuthority: authority,
        schedules: deviceSchedules,
      };
    });
  }

  async markSchedulePublished(
    siteId: string,
    deviceId: string,
    revision: number,
    authority: ScheduleExecutionAuthority,
    publishedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE spff.device_schedule_sync_state
        SET
          published_revision = $3,
          published_authority = $4,
          published_at = $5::timestamptz,
          updated_at = now()
        WHERE site_id = $1
          AND device_id = $2
          AND revision = $3
      `,
      [
        siteId,
        deviceId,
        revision,
        authority,
        publishedAt,
      ],
    );
  }

  async saveScheduleSyncAck(message: ScheduleSyncAckMessage): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO spff.schedule_sync_ack_events (
            site_id,
            device_id,
            revision,
            status,
            stored_schedule_count,
            reason,
            acknowledged_at,
            raw_payload
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
          ON CONFLICT (
            site_id,
            device_id,
            revision,
            status,
            acknowledged_at
          ) DO NOTHING
        `,
        [
          message.siteId,
          message.deviceId,
          message.revision,
          message.status,
          message.storedScheduleCount,
          message.reason ?? null,
          message.acknowledgedAt,
          JSON.stringify(message),
        ],
      );

      await client.query(
        `
          UPDATE spff.device_schedule_sync_state
          SET
            acknowledged_revision = $3,
            acknowledgement_status = $4,
            acknowledged_at = $5::timestamptz,
            acknowledgement_reason = $6,
            stored_schedule_count = $7,
            updated_at = now()
          WHERE site_id = $1
            AND device_id = $2
            AND $3 >= COALESCE(acknowledged_revision, 0)
        `,
        [
          message.siteId,
          message.deviceId,
          message.revision,
          message.status,
          message.acknowledgedAt,
          message.reason ?? null,
          message.storedScheduleCount,
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log("[repository] schedule sync acknowledgement stored", {
      siteId: message.siteId,
      deviceId: message.deviceId,
      revision: message.revision,
      status: message.status,
      storedScheduleCount: message.storedScheduleCount,
    });
  }

  async createScheduledCommand(request: ScheduledCommandRequest): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO spff.control_commands (
            command_id,
            site_id,
            device_id,
            actuator_key,
            command_type,
            requested_is_active,
            requested_by,
            status,
            issued_at,
            expires_at,
            request_payload
          ) VALUES (
            $1, $2, $3, $4, 'set_pump', $5,
            $6, 'pending', $7::timestamptz, $8::timestamptz, $9::jsonb
          )
        `,
        [
          request.commandId,
          request.siteId,
          request.deviceId,
          request.actuatorKey,
          request.requestedIsActive,
          `schedule:${request.scheduleId}:${request.action}`,
          request.issuedAt,
          request.expiresAt,
          JSON.stringify({
            source: "schedule",
            scheduleId: request.scheduleId,
            action: request.action,
            scheduledFor: request.scheduledFor,
            repeatRule: request.repeatRule,
            timezone: request.timezone,
          }),
        ],
      );

      const runResult = await client.query(
        `
          INSERT INTO spff.actuator_schedule_runs (
            schedule_id,
            scheduled_for,
            action,
            command_id
          ) VALUES ($1, $2::timestamptz, $3, $4)
          ON CONFLICT (schedule_id, scheduled_for, action) DO NOTHING
          RETURNING schedule_run_id
        `,
        [
          request.scheduleId,
          request.scheduledFor,
          request.action,
          request.commandId,
        ],
      );

      if ((runResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveTelemetry(message: TelemetryMessage): Promise<void> {
    const raw = asObject(message);
    const sensors = asObject(raw.sensors);
    const schemaVersion =
      typeof raw.schemaVersion === "number" && Number.isInteger(raw.schemaVersion)
        ? raw.schemaVersion
        : 1;
    const recordedAt = requiredTimestamp(
      raw,
      ["recordedAt", "timestamp"],
      "Telemetry recordedAt",
    );
    const sensorValid =
      firstBoolean(raw, ["sensorValid", "sensor_valid"]) ??
      firstBoolean(sensors, ["sensorValid", "sensor_valid"]) ??
      true;

    const values: unknown[] = [
      schemaVersion,
      message.siteId,
      message.deviceId,
      message.messageId,
      message.sequence,
      recordedAt,
      optionalNumber(sensors, "soil_1_moisture"),
      optionalNumber(sensors, "soil_1_temp"),
      optionalNumber(sensors, "soil_1_ec_us_cm"),
      optionalNumber(sensors, "soil_1_ph"),
      optionalNumber(sensors, "soil_1_n"),
      optionalNumber(sensors, "soil_1_p"),
      optionalNumber(sensors, "soil_1_k"),
      optionalNumber(sensors, "soil_2_moisture"),
      optionalNumber(sensors, "soil_2_temp"),
      optionalNumber(sensors, "soil_2_ec_us_cm"),
      optionalNumber(sensors, "soil_2_ph"),
      optionalNumber(sensors, "soil_2_n"),
      optionalNumber(sensors, "soil_2_p"),
      optionalNumber(sensors, "soil_2_k"),
      optionalNumber(sensors, "liquid_ph"),
      optionalNumber(sensors, "liquid_ec_us_cm"),
      optionalNumber(sensors, "liquid_temp"),
      optionalNumber(sensors, "air_temp"),
      optionalNumber(sensors, "air_humidity"),
      optionalNumber(sensors, "tank_water_distance_cm"),
      optionalNumber(sensors, "tank_water_level_pct"),
      optionalNumber(sensors, "tank_fert_distance_cm"),
      optionalNumber(sensors, "tank_fert_level_pct"),
      optionalNumber(sensors, "flow_water_lpm"),
      optionalNumber(sensors, "flow_water_total_l"),
      optionalNumber(sensors, "flow_fert_lpm"),
      optionalNumber(sensors, "flow_fert_total_l"),
      optionalNumber(sensors, "battery_voltage"),
      sensorValid,
      JSON.stringify(message),
    ];

    const result = await this.pool.query(
      `
        INSERT INTO spff.telemetry_samples (
          schema_version,
          site_id,
          device_id,
          message_id,
          sequence,
          recorded_at,
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
          sensor_valid,
          raw_payload
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25,
          $26, $27, $28, $29,
          $30, $31, $32, $33,
          $34, $35, $36::jsonb
        )
        ON CONFLICT (site_id, device_id, message_id) DO NOTHING
        RETURNING telemetry_id
      `,
      values,
    );

    const inserted = (result.rowCount ?? 0) > 0;
    console.log(inserted ? "[repository] telemetry stored" : "[repository] telemetry duplicate ignored", {
      siteId: message.siteId,
      deviceId: message.deviceId,
      messageId: message.messageId,
      sequence: message.sequence,
    });
  }

  async saveAcknowledgement(message: CommandAckMessage): Promise<void> {
    const raw = asObject(message);
    const status = asAckStatus(message.status);
    const acknowledgedAt = requiredTimestamp(
      raw,
      ["acknowledgedAt", "recordedAt", "timestamp"],
      "Acknowledgement timestamp",
    );
    const actualState = firstObject(raw, ["actualState", "actual"]);
    const actualIsActive =
      firstBoolean(raw, ["actualIsActive", "isActive"]) ??
      firstBoolean(actualState, ["isActive", "active"]);
    const reason = firstString(raw, ["reason", "message"]);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const acknowledgementInserted = await this.insertAcknowledgement(
        client,
        message,
        status,
        acknowledgedAt,
        actualIsActive,
        reason,
      );
      await client.query(
        `
          UPDATE spff.control_commands
          SET
            status = $2,
            completed_at = CASE
              WHEN $2 IN ('completed', 'rejected', 'timed_out') THEN $3::timestamptz
              ELSE completed_at
            END,
            reason = COALESCE($4, reason),
            updated_at = now()
          WHERE command_id = $1
        `,
        [message.commandId, status, acknowledgedAt, reason],
      );

      if (acknowledgementInserted && actualIsActive !== null) {
        await client.query(
          `
            INSERT INTO spff.actuator_state_events (
              site_id,
              device_id,
              actuator_key,
              command_id,
              source,
              state,
              is_active,
              reason,
              recorded_at,
              raw_payload
            )
            SELECT
              c.site_id,
              c.device_id,
              c.actuator_key,
              c.command_id,
              'command_ack',
              CASE WHEN $2::boolean THEN 'active' ELSE 'inactive' END,
              $2,
              $3,
              $4::timestamptz,
              $5::jsonb
            FROM spff.control_commands c
            WHERE c.command_id = $1
          `,
          [
            message.commandId,
            actualIsActive,
            reason,
            acknowledgedAt,
            JSON.stringify(message),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log("[repository] acknowledgement stored", {
      commandId: message.commandId,
      deviceId: message.deviceId,
      status,
    });
  }

  async saveActuatorState(message: ActuatorStateMessage): Promise<void> {
    const raw = asObject(message);
    const recordedAt = requiredTimestamp(
      raw,
      ["recordedAt", "timestamp"],
      "Actuator state recordedAt",
    );
    const commandId = firstString(raw, ["commandId"]);
    const reason = firstString(raw, ["reason"]);

    const result = await this.pool.query(
      `
        INSERT INTO spff.actuator_state_events (
          site_id,
          device_id,
          actuator_key,
          message_id,
          command_id,
          source,
          state,
          is_active,
          reason,
          recorded_at,
          raw_payload
        ) VALUES (
          $1, $2, $3, $4, $5, 'telemetry', $6, $7, $8, $9, $10::jsonb
        )
        ON CONFLICT (site_id, device_id, actuator_key, message_id)
          WHERE message_id IS NOT NULL
        DO NOTHING
        RETURNING actuator_state_id
      `,
      [
        message.siteId,
        message.deviceId,
        message.targetId,
        message.messageId,
        commandId,
        message.state,
        message.isActive,
        reason,
        recordedAt,
        JSON.stringify(message),
      ],
    );

    console.log(
      (result.rowCount ?? 0) > 0
        ? "[repository] actuator state stored"
        : "[repository] actuator state duplicate ignored",
      {
        siteId: message.siteId,
        deviceId: message.deviceId,
        targetId: message.targetId,
        state: message.state,
      },
    );
  }

  async saveDeviceStatus(message: DeviceStatusMessage): Promise<void> {
    const raw = asObject(message);
    const recordedAt = requiredTimestamp(
      raw,
      ["recordedAt", "timestamp"],
      "Device status recordedAt",
    );
    const messageId = firstString(raw, ["messageId"]);
    const firmwareVersion = firstString(raw, ["firmwareVersion", "firmware"]);
    const systemState = firstString(raw, ["systemState", "system_state"]);
    const growthPhase = firstString(raw, ["growthPhase", "growth_phase"]);
    const sensorValid = firstBoolean(raw, ["sensorValid", "sensor_valid"]);

    const result = await this.pool.query(
      `
        INSERT INTO spff.device_status_events (
          site_id,
          device_id,
          message_id,
          online,
          mode,
          firmware_version,
          system_state,
          growth_phase,
          sensor_valid,
          recorded_at,
          raw_payload
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb
        )
        ON CONFLICT (site_id, device_id, message_id)
          WHERE message_id IS NOT NULL
        DO NOTHING
        RETURNING device_status_id
      `,
      [
        message.siteId,
        message.deviceId,
        messageId,
        message.online,
        message.mode ?? null,
        firmwareVersion,
        systemState,
        growthPhase,
        sensorValid,
        recordedAt,
        JSON.stringify(message),
      ],
    );

    console.log(
      (result.rowCount ?? 0) > 0
        ? "[repository] device status stored"
        : "[repository] device status duplicate ignored",
      {
        siteId: message.siteId,
        deviceId: message.deviceId,
        online: message.online,
        mode: message.mode,
      },
    );
  }

  async alarmRules(siteId: string): Promise<AlarmRule[]> {
    const result = await this.pool.query<{
      site_id: string;
      rule_key: string;
      source_type: "sensor" | "actuator" | "system";
      source_key: string;
      comparator: AlarmRule["comparator"];
      threshold_value: number | string | null;
      unit: string | null;
      enabled: boolean;
    }>(
      `
        SELECT site_id, rule_key, source_type, source_key, comparator,
               threshold_value, unit, enabled
        FROM spff.alarm_rules
        WHERE site_id = $1 AND enabled = true
        ORDER BY rule_key
      `,
      [siteId],
    );
    return result.rows.map((row) => ({
      siteId: row.site_id,
      ruleKey: row.rule_key,
      sourceType: row.source_type,
      sourceKey: row.source_key,
      comparator: row.comparator,
      thresholdValue:
        row.threshold_value === null ? null : Number(row.threshold_value),
      unit: row.unit,
      enabled: row.enabled,
    }));
  }

  async applyAlarmObservation(observation: AlarmObservation): Promise<void> {
    await this.pool.query(
      `
        SELECT spff.apply_alarm_observation(
          $1, $2, $3, $4, $5, $6, $7::timestamptz,
          $8, $9, $10::jsonb
        )
      `,
      [
        observation.siteId,
        observation.deviceId,
        observation.ruleKey,
        observation.incidentKey,
        observation.sourceKey,
        observation.violating,
        observation.observedAt,
        observation.currentValue,
        observation.thresholdText,
        JSON.stringify(observation.metadata),
      ],
    );
  }

  async alarmHealthSubjects(): Promise<AlarmHealthSubject[]> {
    const result = await this.pool.query<{
      site_id: string;
      device_id: string;
      device_online: boolean | null;
      device_age_seconds: number | string | null;
      telemetry_age_seconds: number | string | null;
      recorded_at: Date | string | null;
      air_temp: number | string | null;
      air_humidity: number | string | null;
    }>(
      `
        SELECT
          device.site_id,
          device.device_id,
          status.online AS device_online,
          extract(epoch FROM (clock_timestamp() - status.received_at))
            AS device_age_seconds,
          extract(epoch FROM (clock_timestamp() - telemetry.received_at))
            AS telemetry_age_seconds,
          telemetry.recorded_at,
          telemetry.air_temp,
          telemetry.air_humidity
        FROM spff.devices device
        LEFT JOIN LATERAL (
          SELECT online, received_at
          FROM spff.device_status_events candidate
          WHERE candidate.site_id = device.site_id
            AND candidate.device_id = device.device_id
          ORDER BY candidate.received_at DESC, candidate.device_status_id DESC
          LIMIT 1
        ) status ON true
        LEFT JOIN LATERAL (
          SELECT recorded_at, received_at, air_temp, air_humidity
          FROM spff.telemetry_samples candidate
          WHERE candidate.site_id = device.site_id
            AND candidate.device_id = device.device_id
          ORDER BY candidate.received_at DESC, candidate.telemetry_id DESC
          LIMIT 1
        ) telemetry ON true
        WHERE device.enabled = true
        ORDER BY device.site_id, device.device_id
      `,
    );

    const numeric = (value: number | string | null): number | null => {
      if (value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const iso = (value: Date | string | null): string | null => {
      if (value === null) return null;
      const parsed = value instanceof Date ? value : new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    };

    return result.rows.map((row) => ({
      siteId: row.site_id,
      deviceId: row.device_id,
      deviceOnline: row.device_online,
      deviceAgeSeconds: numeric(row.device_age_seconds),
      telemetryAgeSeconds: numeric(row.telemetry_age_seconds),
      latestRecordedAt: iso(row.recorded_at),
      sensors: {
        air_temp: numeric(row.air_temp),
        air_humidity: numeric(row.air_humidity),
      },
    }));
  }

  async alarmCommandSubjects(): Promise<AlarmCommandSubject[]> {
    const result = await this.pool.query<{
      site_id: string;
      device_id: string;
      actuator_key: string;
      command_id: string;
      status: AlarmCommandSubject["status"];
      reason: string | null;
      updated_at: Date | string;
    }>(
      `
        SELECT
          actuator.site_id,
          actuator.device_id,
          actuator.actuator_key,
          latest.command_id,
          latest.status,
          latest.reason,
          latest.updated_at
        FROM spff.actuators actuator
        CROSS JOIN LATERAL (
          SELECT command_id, status, reason, updated_at
          FROM spff.control_commands command
          WHERE command.site_id = actuator.site_id
            AND command.device_id = actuator.device_id
            AND command.actuator_key = actuator.actuator_key
            AND command.status IN (
              'completed',
              'rejected',
              'timed_out',
              'failed'
            )
          ORDER BY command.updated_at DESC, command.created_at DESC
          LIMIT 1
        ) latest
        LEFT JOIN spff.alarm_rule_states state
          ON state.site_id = actuator.site_id
         AND state.device_id = actuator.device_id
         AND state.incident_key = 'command_failed:' || actuator.actuator_key
        WHERE actuator.enabled = true
          AND (
            state.last_observed_at IS NULL
            OR latest.updated_at > state.last_observed_at
          )
        ORDER BY actuator.site_id, actuator.device_id, actuator.actuator_key
      `,
    );

    return result.rows.map((row) => ({
      siteId: row.site_id,
      deviceId: row.device_id,
      targetId: row.actuator_key,
      commandId: row.command_id,
      status: row.status,
      reason: row.reason,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
    }));
  }

  private async insertAcknowledgement(
    client: PoolClient,
    message: CommandAckMessage,
    status: AckStatus,
    acknowledgedAt: string,
    actualIsActive: boolean | null,
    reason: string | null,
  ): Promise<boolean> {
    const result = await client.query(
      `
        INSERT INTO spff.command_ack_events (
          command_id,
          status,
          actual_is_active,
          reason,
          acknowledged_at,
          raw_payload
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (command_id, status, acknowledged_at) DO NOTHING
        RETURNING ack_event_id
      `,
      [
        message.commandId,
        status,
        actualIsActive,
        reason,
        acknowledgedAt,
        JSON.stringify(message),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
