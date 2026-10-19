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

test('session outbox must wait for persisted ACK, not MQTT QoS acknowledgement',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'spff-session-'));
  try {
    const outbox=new DurableOutbox(dir,10);
    await outbox.start();
    await outbox.enqueue({kind:'session',payload:{
      kind:'fertigation_session_event',schemaVersion:1,
      siteId:'greenhouse-01',deviceId:'esp32-s3-01',
      sessionId:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
      recipeId:'e247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
      messageId:'session-001',sequence:1,recordedAt:'2026-10-19T08:00:00Z',
      status:'started',targetWaterL:1,targetStockL:0,
      actualWaterL:0,actualStockL:0,pumpsOff:true,completionReason:null,
    }});
    await outbox.flush(async()=>{});
    assert.equal((await readdir(dir)).filter(x=>x.endsWith('.json')).length,1);
    assert.equal(await outbox.acknowledgeTelemetry('session-001'),false);
    assert.equal(await outbox.acknowledgeSession('session-001'),true);
    assert.equal((await readdir(dir)).filter(x=>x.endsWith('.json')).length,0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
