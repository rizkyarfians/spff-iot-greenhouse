import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DurableOutbox } from '../dist/outbox.js';

const telemetry = {
  kind: 'telemetry',
  payload: {
    kind: 'telemetry',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: 'msg-1',
    sequence: 1,
    recordedAt: '2026-08-17T06:00:00.000Z',
    sensors: { air_temp: 25.1 },
  },
};

test('durable outbox keeps telemetry until persistence acknowledgement', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spff-outbox-'));
  try {
    const outbox = new DurableOutbox(dir, 10);
    await outbox.start();
    await outbox.enqueue(telemetry);
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.json')).length, 1);

    await assert.rejects(() => outbox.flush(async () => { throw new Error('broker down'); }));
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.json')).length, 1);

    let delivered = 0;
    await outbox.flush(async () => { delivered += 1; });
    assert.equal(delivered, 1);
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.json')).length, 1);

    assert.equal(await outbox.acknowledgeTelemetry('msg-1'), true);
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.json')).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
