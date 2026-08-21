import pg from 'pg';
import { telemetrySensorKeys } from '@spff/contracts';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'spff',
  user: process.env.PGUSER ?? 'spff_app',
  password: process.env.PGPASSWORD,
  max: 1,
});

const requiredRelations = [
  'spff.sites',
  'spff.devices',
  'spff.sensor_definitions',
  'spff.telemetry_samples',
  'spff.actuators',
  'spff.control_commands',
  'spff.command_ack_events',
  'spff.actuator_state_events',
  'spff.device_status_events',
  'spff.alarms',
  'spff.system_logs',
  'spff.actuator_schedules',
  'spff.schedule_executions',
  'spff.site_settings',
  'spff.cloud_outbox',
  'spff.latest_telemetry',
  'spff.latest_actuator_states',
  'spff.latest_device_status',
];

try {
  const identity = await pool.query(`SELECT current_database() AS database, current_user AS role, current_setting('TimeZone') AS timezone`);
  console.log('PostgreSQL:', identity.rows[0]);

  let failed = false;
  for (const relation of requiredRelations) {
    const result = await pool.query('SELECT to_regclass($1) AS relation', [relation]);
    const ok = result.rows[0].relation !== null;
    console.log(`${ok ? 'OK ' : 'ERR'} ${relation}`);
    failed ||= !ok;
  }

  const telemetryColumns = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'spff' AND table_name = 'telemetry_samples'`,
  );
  const actual = new Set(telemetryColumns.rows.map((row) => row.column_name));
  const expectedSensors = [...telemetrySensorKeys];
  const missingSensors = expectedSensors.filter((column) => !actual.has(column));
  console.log(`${missingSensors.length === 0 ? 'OK ' : 'ERR'} telemetry sensor columns: ${expectedSensors.length - missingSensors.length}/${expectedSensors.length}`);
  if (missingSensors.length) console.log('Missing:', missingSensors.join(', '));
  failed ||= missingSensors.length > 0;

  const duplicateMessages = await pool.query(
    `SELECT count(*)::int AS duplicate_groups FROM (
       SELECT site_id, device_id, message_id FROM spff.telemetry_samples
       GROUP BY site_id, device_id, message_id HAVING count(*) > 1
     ) d`,
  );
  const duplicates = duplicateMessages.rows[0].duplicate_groups;
  console.log(`${duplicates === 0 ? 'OK ' : 'ERR'} telemetry duplicate message groups: ${duplicates}`);
  failed ||= duplicates !== 0;

  const actuators = await pool.query(
    `SELECT actuator_key FROM spff.actuators WHERE enabled = true ORDER BY actuator_key`,
  );
  console.log(`INFO enabled actuators: ${actuators.rows.map((row) => row.actuator_key).join(', ') || '(none)'}`);

  const publicCreate = await pool.query(`SELECT has_schema_privilege('public', 'public', 'CREATE') AS allowed`);
  console.log(`${publicCreate.rows[0].allowed ? 'WARN' : 'OK  '} PUBLIC CREATE on public schema: ${publicCreate.rows[0].allowed}`);

  if (failed) process.exitCode = 1;
} finally {
  await pool.end();
}
