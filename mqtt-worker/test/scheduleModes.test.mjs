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

test('pending manual ON is mode-gated and legacy schedule ON cannot bypass sensors', async () => {
  let sql;
  const repository = new PostgresIngestionRepository({ query: async text => { sql = text; return { rows: [] }; } });
  await repository.pendingCommands(20);
  assert.match(sql, /requested_is_active = false OR/);
  assert.match(sql, /requested_by NOT LIKE 'schedule:%'/);
  assert.match(sql, /mode_config.desired_mode = 'manual'/);
  assert.match(sql, /acknowledged_revision = mode_config.revision/);
});

test('firmware keeps sensor controllers, gated by independent schedule windows', () => {
  const firmware = readFileSync(new URL('../../firmware/SPFF_MASTER_1.4.10_SCHEDULE_SENSOR/SPFF_MASTER_1.4.10_SCHEDULE_SENSOR.ino', import.meta.url), 'utf8');
  assert.doesNotMatch(firmware, /const bool automatic = false;/);
  assert.match(firmware, /requestedActive && \(scheduleCommand \|\| scheduleMode\)/);
  assert.match(firmware, /requestedBy.startsWith\("schedule:"\)/);
  assert.match(firmware, /!spffScheduleWindowOpen\(SPFF_SCHEDULE_TARGET_WATER\)/);
  assert.match(firmware, /!spffScheduleWindowOpen\(SPFF_SCHEDULE_TARGET_FERT\)/);
  assert.match(firmware, /second >= schedule.onSecond && second < schedule.offSecond/);
  assert.match(firmware, /spffAutomaticPaused = true;/);
  assert.doesNotMatch(firmware, /candidate.water.enabled = 0U;/);
  assert.doesNotMatch(firmware, /candidate.fertilizer.enabled = 0U;/);
  const scheduleLoop = firmware.slice(firmware.indexOf('void serviceSpffSyncedScheduleOutput() {'), firmware.indexOf('void processSpffCommandLine(const String &line) {'));
  assert.doesNotMatch(scheduleLoop, /spffApplySyncedScheduleTarget\(/);
});
