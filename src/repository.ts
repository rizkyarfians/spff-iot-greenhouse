import type {
  CommandAckMessage,
  DeviceStatusMessage,
  TelemetryMessage,
} from "@spff/contracts";
import { Pool, type PoolClient } from "pg";
import { config } from "./config.js";

export interface IngestionRepository {
  saveTelemetry(message: TelemetryMessage): Promise<void>;
  saveAcknowledgement(message: CommandAckMessage): Promise<void>;
  saveDeviceStatus(message: DeviceStatusMessage): Promise<void>;
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

export class PostgresIngestionRepository implements IngestionRepository {
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
      await this.insertAcknowledgement(
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

  private async insertAcknowledgement(
    client: PoolClient,
    message: CommandAckMessage,
    status: AckStatus,
    acknowledgedAt: string,
    actualIsActive: boolean | null,
    reason: string | null,
  ): Promise<void> {
    await client.query(
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
  }
}
