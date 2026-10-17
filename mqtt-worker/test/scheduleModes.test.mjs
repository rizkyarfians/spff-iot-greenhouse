import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Repository imports runtime config; supply isolated test settings before import.
process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
process.env.MQTT_URL = 'mqtt://localhost:1883';
const { PostgresIngestionRepository } = await import('../dist/repository.js');

test('schedule execution requires applied mode while snapshots can precede ACK', async () => {
  const queries = [];
  const repository = new PostgresIngestionRepository({
    query: async (sql, values) => { queries.push({ sql, values }); return { rows: [] }; },
  });
  await repository.enabledSchedules();
  const execution = queries.find(q => q.sql.includes('FROM spff.actuators actuator'));
  assert.match(execution.sql, /desired_mode = 'automatic'/);
  assert.match(execution.sql, /acknowledged_revision = automatic_control.revision/);
  assert.deepEqual(execution.values, [true]);
  queries.length = 0;
  await repository.enabledSchedules(false);
  assert.deepEqual(queries.find(q => q.sql.includes('FROM spff.actuators actuator')).values, [false]);
});

test('pending ON commands are mode-gated but OFF remains allowed', async () => {
  let sql;
  const repository = new PostgresIngestionRepository({ query: async text => { sql = text; return { rows: [] }; } });
  await repository.pendingCommands(20);
  assert.match(sql, /requested_is_active = false OR EXISTS/);
  assert.match(sql, /WHEN requested_by LIKE 'schedule:%' THEN 'automatic'/);
  assert.match(sql, /ELSE 'manual'/);
  assert.match(sql, /acknowledged_revision = mode_config.revision/);
});

test('firmware source gates schedule commands and disables sensor-driven loop', () => {
  const firmware = readFileSync(new URL('../../firmware/SPFF_MASTER_1.4.9_SCHEDULE_MODES/SPFF_MASTER_1.4.9_SCHEDULE_MODES.ino', import.meta.url), 'utf8');
  assert.match(firmware, /const bool automatic = false;/);
  assert.match(firmware, /requestedActive && \(scheduleCommand != scheduleMode\)/);
  assert.match(firmware, /requestedBy.startsWith\("schedule:"\)/);
  assert.match(firmware, /spffAutomaticControl.desiredMode != SPFF_MODE_AUTOMATIC/);
  assert.match(firmware, /candidate.water.enabled = 0U;/);
  assert.match(firmware, /candidate.fertilizer.enabled = 0U;/);
});
