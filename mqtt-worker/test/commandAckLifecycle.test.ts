import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandAckMessage } from '@spff/contracts';
import { PostgresIngestionRepository, type DatabasePool } from '../src/repository.js';

type Query = { text: string; values: unknown[] };
const completion: CommandAckMessage = {
  kind: 'command_ack',
  schemaVersion: 1,
  siteId: 'greenhouse-01',
  deviceId: 'esp32-s3-01',
  commandId: 'web-d167c52a-4b62-4dc0-9b0b-4a995b7524c6',
  targetId: 'pump_water',
  status: 'completed',
  // Deliberately earlier than the server command issuance.
  acknowledgedAt: '2026-11-03T09:33:18.000Z',
  actualState: { isActive: false },
};

function fakeRepository(commandUpdateCount: number) {
  const queries: Query[] = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (/UPDATE spff\.control_commands/.test(text)) {
        return { rows: commandUpdateCount ? [{ command_id: completion.commandId }] : [], rowCount: commandUpdateCount };
      }
      return { rows: [{ ack_event_id: 1830 }], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query() { throw new Error('unexpected pool.query'); },
    async end() {},
  } as unknown as DatabasePool;
  return { repo: new PostgresIngestionRepository(pool), queries };
}

test('terminal ACK uses server DB clock; MCU timestamp remains in the ACK audit event', async () => {
  const { repo, queries } = fakeRepository(1);
  await repo.saveAcknowledgement(completion);
  const commandUpdate = queries.find(q => /UPDATE spff\.control_commands/.test(q.text));
  const ackInsert = queries.find(q => /INSERT INTO spff\.command_ack_events/.test(q.text));
  assert.ok(commandUpdate);
  assert.ok(ackInsert);
  assert.match(commandUpdate.text, /GREATEST\(now\(\), issued_at\)/);
  assert.match(commandUpdate.text, /AND status IN \('pending','published','accepted'\)/);
  assert.doesNotMatch(commandUpdate.text, /THEN \$3::timestamptz/);
  // Every parameter position must be used and type-inferable by PostgreSQL.
  const indexes = [...commandUpdate.text.matchAll(/\$(\d+)\b/g)].map((match) => Number(match[1]));
  assert.deepEqual([...new Set(indexes)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(commandUpdate.values.length, 7);
  assert.equal(commandUpdate.values[2], null);
  assert.equal(commandUpdate.values[3], completion.siteId);
  assert.equal(commandUpdate.values[6], false);
  // ESP32 time remains evidence-only, in the append-only acknowledgement table.
  assert.equal(ackInsert.values[4], completion.acknowledgedAt);
  assert.equal(queries.some(q => /INSERT INTO spff\.actuator_state_events/.test(q.text)), true);
});

test('out-of-order accepted after completed cannot reopen a terminal command', async () => {
  const { repo, queries } = fakeRepository(0); // DB guard rejects terminal mutation
  await repo.saveAcknowledgement({ ...completion, status: 'accepted', actualState: undefined });
  const commandUpdate = queries.find(q => /UPDATE spff\.control_commands/.test(q.text));
  assert.ok(commandUpdate);
  assert.match(commandUpdate.text, /AND status IN \('pending','published','accepted'\)/);
  assert.equal(queries.some(q => /INSERT INTO spff\.command_ack_events/.test(q.text)), true);
  assert.equal(queries.some(q => /INSERT INTO spff\.actuator_state_events/.test(q.text)), false);
});
