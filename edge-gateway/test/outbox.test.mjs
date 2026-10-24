import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
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

test('pulse ACK survives edge restart and a failed MQTT publish',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'spff-pulse-ack-'));
  try{
    const first=new DurableOutbox(dir,10);await first.start();
    const payload={kind:'fertigation_pulse_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',
      sessionId:'00000000-0000-4000-8000-000000000001',commandId:'00000000-0000-4000-8000-000000000002',
      cycle:1,status:'completed',pumpsOff:true,reason:'pulse_duration_elapsed',acknowledgedAt:'2026-10-21T04:00:00Z'};
    await first.enqueue({kind:'pulse_ack',payload});
    const restarted=new DurableOutbox(dir,10);await restarted.start();
    await assert.rejects(restarted.flush(async()=>{throw new Error('offline')}));
    const sent=[];await restarted.flush(async record=>{sent.push(record)});
    assert.deepEqual(sent,[{kind:'pulse_ack',payload}]);
    assert.equal((await readdir(dir)).filter(x=>x.endsWith('.json')).length,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('empty and truncated files are preserved in quarantine while healthy telemetry still waits for DB ACK', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spff-corrupt-'));
  try {
    const outbox = new DurableOutbox(dir, 10);
    await outbox.start();
    await writeFile(path.join(dir, '000-empty.json'), '');
    await writeFile(path.join(dir, '001-truncated.json'), '{"kind":');
    await outbox.enqueue(telemetry);
    const sent = [];
    await outbox.flush(async record => { sent.push(record); });
    assert.deepEqual(sent, [telemetry]);
    const quarantined = await readdir(path.join(dir, 'quarantine'));
    assert.equal(quarantined.length, 2);
    const preserved = await Promise.all(quarantined.map(name => readFile(path.join(dir, 'quarantine', name), 'utf8')));
    assert.deepEqual(preserved.sort(), ['', '{"kind":'].sort());
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.json')).length, 1);
    const restarted = new DurableOutbox(dir, 1);
    await restarted.start();
    assert.equal(await restarted.acknowledgeTelemetry('msg-1'), true);
    await restarted.enqueue(telemetry); // Quarantine is not part of the queue limit.
    await restarted.flush(async record => { assert.deepEqual(record, telemetry); });
    assert.equal((await readdir(path.join(dir, 'quarantine'))).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('persistence ACK scan also quarantines corrupt JSON without losing session ACK processing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spff-corrupt-ack-'));
  try {
    const outbox = new DurableOutbox(dir, 10);
    await outbox.start();
    await writeFile(path.join(dir, '000-empty.json'), '');
    await outbox.enqueue({ kind: 'session', payload: { ...telemetry.payload, messageId: 'session-ack' } });
    await outbox.enqueue(telemetry);
    assert.equal(await outbox.acknowledgeSession('session-ack'), true);
    assert.equal(await outbox.acknowledgeTelemetry('msg-1'), true);
    assert.equal((await readdir(path.join(dir, 'quarantine'))).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('read errors pause flush rather than quarantining a storage failure', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spff-outbox-read-'));
  try {
    const outbox = new DurableOutbox(dir, 10);
    await outbox.start();
    await writeFile(path.join(dir, '000-first.json'), JSON.stringify(telemetry));
    const second = path.join(dir, '001-second.json');
    await writeFile(second, JSON.stringify(telemetry));
    await assert.rejects(outbox.flush(async () => {
      // Turn a snapshotted file into a directory to force a real read failure.
      await unlink(second);
      await mkdir(second);
    }), /Outbox read failed for .*001-second\.json/);
    assert.equal((await readdir(dir)).includes('quarantine'), false);
    assert.ok((await readdir(dir)).includes('000-first.json'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed quarantine never deletes the source or continues as if it were delivered', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spff-quarantine-fail-'));
  try {
    const outbox = new DurableOutbox(dir, 10);
    await outbox.start();
    await writeFile(path.join(dir, 'quarantine'), 'blocked destination');
    await writeFile(path.join(dir, '000-empty.json'), '');
    await outbox.enqueue(telemetry);
    let sent = 0;
    await assert.rejects(outbox.flush(async () => { sent++; }));
    assert.equal(sent, 0);
    assert.equal(await readFile(path.join(dir, '000-empty.json'), 'utf8'), '');
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.json')).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a file removed after the directory snapshot does not wedge future flushes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spff-outbox-race-'));
  try {
    const outbox = new DurableOutbox(dir, 10);
    await outbox.start();
    await writeFile(path.join(dir, '000-first.json'), JSON.stringify(telemetry));
    const second = path.join(dir, '001-second.json');
    await writeFile(second, JSON.stringify(telemetry));
    let sent = 0;
    await outbox.flush(async () => { sent++; await unlink(second); });
    assert.equal(sent, 1);
    await outbox.flush(async () => { sent++; });
    assert.equal(sent, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('concurrent flush and persistence ACK preserve only one quarantine copy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spff-outbox-concurrent-'));
  try {
    const outbox = new DurableOutbox(dir, 10);
    await outbox.start();
    await writeFile(path.join(dir, '000-empty.json'), '');
    await outbox.enqueue(telemetry);
    await Promise.all([
      outbox.flush(async () => {}),
      outbox.acknowledgeTelemetry('msg-1'),
    ]);
    assert.equal((await readdir(path.join(dir, 'quarantine'))).length, 1);
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.json')).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
