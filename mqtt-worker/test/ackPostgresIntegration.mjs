import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresIngestionRepository } from '../dist/repository.js';

// This script MUST be launched only by runAckPostgresIntegration.sh under
// pg_virtualenv (isolated, disposable DB); no real MQTT publisher is created.
if (process.env.SPFF_ISOLATED_PG_ACK_TEST !== 'yes' ||
    !process.env.PGPORT || process.env.PGPORT === '5432') {
  throw new Error('Refusing ACK test outside verified isolated PostgreSQL.');
}

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});
const repo = new PostgresIngestionRepository(pool);

const commandId = 'ack-isolated-001';
const ack = {
  schemaVersion: 1,
  kind: 'command_ack',
  siteId: 'greenhouse-01',
  deviceId: 'esp32-s3-01',
  commandId,
  targetId: 'pump_water',
  acknowledgedAt: '2026-11-03T09:33:18.000Z',
  status: 'completed',
  actualState: { isActive: false },
};

async function assertCommandCompleted() {
  const { rows } = await pool.query(
    'SELECT status,issued_at,completed_at FROM spff.control_commands WHERE command_id=$1',
    [commandId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'completed');
  assert.ok(rows[0].completed_at instanceof Date);
  assert.ok(rows[0].completed_at >= rows[0].issued_at);
}

try {
  const { rows: environment } = await pool.query(
    'SELECT current_database() AS db, current_setting($1) AS port',
    ['port'],
  );
  assert.notEqual(environment[0].db, 'spff');
  assert.equal(environment[0].port, process.env.PGPORT);

  await repo.saveAcknowledgement(ack);
  await assertCommandCompleted();
  console.log('PASS 1/5: completed_at >= issued_at, despite MCU clock skew');

  const lateAccepted = { ...ack, status: 'accepted', actualState: undefined };
  await repo.saveAcknowledgement(lateAccepted);
  await assertCommandCompleted();
  console.log('PASS 2/5: late accepted ACK cannot reopen completed');

  const expired = await repo.expireCommands();
  assert.equal(expired, 0);
  await assertCommandCompleted();
  console.log('PASS 3/5: expiry cannot change completed');

  await repo.saveAcknowledgement(ack); // QoS1 duplicate terminal ACK
  await assertCommandCompleted();
  console.log('PASS 4/5: duplicate completed ACK is idempotent');

  const { rows: eventRows } = await pool.query(
    'SELECT COUNT(*)::int AS total FROM spff.actuator_state_events',
  );
  assert.equal(eventRows[0].total, 1);
  const { rows: auditRows } = await pool.query(
    'SELECT status,acknowledged_at FROM spff.command_ack_events ORDER BY ack_event_id',
  );
  assert.deepEqual(auditRows.map((row) => row.status), ['completed', 'accepted']);
  assert.equal(auditRows[0].acknowledged_at.toISOString(), ack.acknowledgedAt);
  console.log('PASS 5/5: 1 actual-state event; both unique ACKs audited with MCU times');

  console.log('RESULT: 5/5 PASS - ISOLATED POSTGRESQL');
} finally {
  await pool.end();
}
