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
  assert.match(sql, /m\.desired_mode = 'automatic'/);
  assert.match(sql, /st\.raw_payload->>'pulseBootId' = request_payload->'waterTrial'->>'bootId'/);
  assert.match(sql, /st\.raw_payload->>'waterInterlockEnabled' = 'true'/);
  assert.match(sql, /wi\.acknowledged_revision = wi\.revision/);
  assert.match(sql, /a\.received_at BETWEEN now\(\) - interval '30 seconds' AND now\(\) \+ interval '2 seconds'/);
  assert.match(sql, /latest\.device_status_id/);
  assert.match(sql, /other\.status IN \('pending','published','accepted'\)/);
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM spff\.actuator_schedules/);
});
