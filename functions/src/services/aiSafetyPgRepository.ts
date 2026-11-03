import pg from 'pg';
import type { AiSafetyRows } from './aiSafetyGates.js';

const { Pool } = pg;
const safeId = /^[a-zA-Z0-9_-]{1,120}$/;

export type AiSafetyDatabaseConfig =
  | { configured: false; siteId: string | null; deviceId: string | null }
  | {
      configured: true; siteId: string; deviceId: string;
      host: string; port: number; database: string; user: string; password: string;
    };

/** Explicit opt-in. Never silently inherit the operational writable PGUSER. */
export function getAiSafetyDatabaseConfig(env: NodeJS.ProcessEnv): AiSafetyDatabaseConfig {
  const siteId = env.SPFF_AI_SAFETY_SITE_ID ?? null;
  const deviceId = env.SPFF_AI_SAFETY_DEVICE_ID ?? null;
  const host = env.SPFF_AI_SAFETY_PGHOST;
  const port = Number(env.SPFF_AI_SAFETY_PGPORT ?? 5432);
  const database = env.SPFF_AI_SAFETY_PGDATABASE;
  const user = env.SPFF_AI_SAFETY_PGUSER;
  const password = env.SPFF_AI_SAFETY_PGPASSWORD;
  if (env.SPFF_AI_SAFETY_DB_ENABLED !== 'true' ||
      !siteId || !deviceId || !safeId.test(siteId) || !safeId.test(deviceId) ||
      !host || !database || !user || !password ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    return { configured: false, siteId, deviceId };
  }
  return { configured: true, siteId, deviceId, host, port, database, user, password };
}

export async function loadAiSafetyRows(config: Extract<AiSafetyDatabaseConfig, { configured: true }>): Promise<AiSafetyRows> {
  const pool = new Pool({
    host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password,
    application_name: 'spff-ai-safety-evidence-ro', max: 1,
    connectionTimeoutMillis: 4000, idleTimeoutMillis: 1000,
    options: '-c default_transaction_read_only=on',
  });
  try {
    const client = await pool.connect();
    try {
      // Repeatable snapshot and explicit read-only transaction; no writes/locks.
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      try {
        const args = [config.siteId, config.deviceId];
        const device = (await client.query(
          'SELECT enabled FROM spff.devices WHERE site_id=$1 AND device_id=$2', args)).rows[0] ?? null;
        const status = (await client.query(
          \`SELECT online,mode,firmware_version,recorded_at,received_at,raw_payload
           FROM spff.device_status_events WHERE site_id=$1 AND device_id=$2
           ORDER BY received_at DESC,device_status_id DESC LIMIT 1\`, args)).rows[0] ?? null;
        const telemetry = (await client.query(
          \`SELECT recorded_at,received_at,sensor_valid
           FROM spff.telemetry_samples WHERE site_id=$1 AND device_id=$2
           ORDER BY received_at DESC,telemetry_id DESC LIMIT 1\`, args)).rows[0] ?? null;
        const actuators = (await client.query(
          \`SELECT actuator_key,state,is_active,source,recorded_at,received_at
           FROM spff.latest_actuator_states
           WHERE site_id=$1 AND device_id=$2 AND actuator_key IN ('pump_water','pump_fert')\`,
          args)).rows;
        const automatic = (await client.query(
          \`SELECT revision,acknowledged_revision,acknowledgement_status,desired_mode,applied_mode
           FROM spff.device_automatic_control_configs
           WHERE site_id=$1 AND device_id=$2\`, args)).rows[0] ?? null;
        const interlock = (await client.query(
          \`SELECT revision,enabled,acknowledged_revision,acknowledgement_status,applied_enabled
           FROM spff.device_water_interlock_configs
           WHERE site_id=$1 AND device_id=$2\`, args)).rows[0] ?? null;
        const unfinished = (await client.query(
          \`SELECT EXISTS(SELECT 1 FROM spff.control_commands
           WHERE site_id=$1 AND device_id=$2 AND status IN ('pending','published','accepted')) AS busy\`,
          args)).rows[0]?.busy === true;
        const schedules = (await client.query(
          \`SELECT EXISTS(SELECT 1 FROM spff.actuator_schedules
           WHERE site_id=$1 AND device_id=$2 AND enabled
           AND actuator_key IN ('pump_water','pump_fert')) AS busy\`, args)).rows[0]?.busy === true;
        const soilSession = (await client.query(
          \`SELECT EXISTS(SELECT 1 FROM spff.soil_ec_pulse_sessions
           WHERE site_id=$1 AND device_id=$2 AND status IN ('waiting','in_flight','fault')) AS busy\`,
          args)).rows[0]?.busy === true;
        const adaptiveSession = (await client.query(
          \`SELECT EXISTS(SELECT 1 FROM spff.adaptive_fert_sessions
           WHERE site_id=$1 AND device_id=$2 AND status NOT IN ('completed','fault')) AS busy\`,
          args)).rows[0]?.busy === true;
        await client.query('COMMIT');
        return {
          device, status, telemetry, actuators, automatic, interlock,
          unfinished, schedules, soilSession, adaptiveSession,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
