import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresIngestionRepository, type DatabasePool } from '../src/repository.js';

test('SQL excludes AI ACC from Manual command branch and requires explicit gate + fresh safety evidence', async () => {
  let sql = '';
  let params: unknown[] = [];
  const pool = {
    async query(text: string, values: unknown[] = []) {
      sql = text; params = values;
      return { rows: [], rowCount: 0 };
    },
    async connect() { throw new Error('unexpected connection'); },
    async end() {},
  } as unknown as DatabasePool;

  await new PostgresIngestionRepository(pool).pendingCommands(5);
  assert.deepEqual(params.slice(0, 1), [5]);
  assert.equal(typeof params[1], 'boolean');
  assert.match(sql, /requested_by NOT LIKE 'trial:water:ai:%'/);
  assert.match(sql, /COALESCE\(request_payload->>'source', ''\) <> 'ai-operator-acc-water-only-trial'/);
  assert.match(sql, /\$2::boolean = true/);
  assert.match(sql, /FROM spff\.ai_execution_modes ai_mode/);
  assert.match(sql, /ai_mode\.mode = 'live'/);
  assert.match(sql, /ai_mode\.device_id = spff\.control_commands\.device_id/);
  assert.match(sql, /m\.desired_mode = 'automatic'/);
  assert.match(sql, /st\.raw_payload->>'pulseBootId' = request_payload->'waterTrial'->>'bootId'/);
  assert.match(sql, /st\.firmware_version = '1\.5\.07-AI-ACC-SESSION'/);
  assert.match(sql, /st\.recorded_at BETWEEN now\(\) - interval '45 seconds'/);
  assert.match(sql, /recent\.received_at BETWEEN now\(\) - interval '45 seconds'/);
  assert.match(sql, /st\.raw_payload->>'aiAccTankGuardHealthy' = 'true'/);
  assert.match(sql, /st\.raw_payload->>'pumpReadbackValid' = 'true'/);
  assert.match(sql, /st\.raw_payload->>'pumpWaterActualActive' = 'false'/);
  assert.match(sql, /st\.raw_payload->>'pumpFertActualActive' = 'false'/);
  assert.match(sql, /wi\.acknowledged_revision = wi\.revision/);
  assert.match(sql, /wi\.enabled = wi\.applied_enabled/);
  assert.match(sql, /st\.raw_payload->>'waterInterlockEnabled' = wi\.applied_enabled::text/);
  assert.doesNotMatch(sql, /st\.firmware_version LIKE '1\.5\.04/);
  assert.doesNotMatch(sql, /wi\.enabled = true/);
  assert.doesNotMatch(sql, /a\.received_at BETWEEN/);
  assert.match(sql, /latest\.device_status_id/);
  assert.match(sql, /other\.status IN \('pending','published','accepted'\)/);
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM spff\.actuator_schedules/);
});

test('AI mode is checked again before MQTT publish; OFF/SHADOW are blocked', async () => {
  const command = {
    commandId: '735c5f48-6845-4a60-a770-1780c521e751',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    actuatorKey: 'pump_water',
    requestedIsActive: true,
    requestedBy: 'trial:water:ai:admin',
    issuedAt: '2026-11-03T09:00:00.000Z',
    expiresAt: '2026-11-03T09:00:15.000Z',
    source: 'ai-operator-acc-water-only-trial',
  };
  let sql = '';
  const pool = {
    async query(text: string, values: unknown[] = []) {
      sql = text;
      assert.deepEqual(values, [command.commandId, command.siteId, command.deviceId]);
      return {rows:[{allowed:false}],rowCount:1};
    },
    async connect() { throw new Error('unexpected connection'); },
    async end() {},
  } as unknown as DatabasePool;
  const repo = new PostgresIngestionRepository(pool);
  assert.equal(await repo.recheckAiDispatch(command),false);
  assert.match(sql,/mode\.mode='live'/);
  assert.match(sql,/c\.status='pending'/);
  assert.match(sql,/c\.expires_at > now\(\)/);
});
