import assert from 'node:assert/strict';
import test from 'node:test';
import { IngestionService } from '../dist/ingestionService.js';

function repositorySpy() {
  const calls = [];
  return {
    calls,
    saveTelemetry: async (message) => calls.push(['telemetry', message]),
    saveFertigationSession: async (message) => calls.push(['session', message]),
    saveActuatorState: async (message) => calls.push(['state', message]),
    saveAcknowledgement: async (message) => calls.push(['ack', message]),
    saveScheduleSyncAck: async (message) => calls.push(['schedule_ack', message]),
    saveAutomaticControlAck: async (message) => calls.push(['automatic_control_ack', message]),
    saveDeviceStatus: async (message) => calls.push(['status', message]),
  };
}

test('state topic is validated and sent to actuator state repository', async () => {
  const repository = repositorySpy();
  const service = new IngestionService(repository);
  const payload = Buffer.from(JSON.stringify({
    kind: 'actuator_state', schemaVersion: 1,
    siteId: 'greenhouse-01', deviceId: 'esp32-s3-01',
    messageId: 'state-1', recordedAt: '2026-08-17T06:00:00.000Z',
    commandId: 'cmd-1', targetId: 'pump_water',
    state: 'inactive', isActive: false,
  }));
  await service.process('spff/v1/greenhouse-01/esp32-s3-01/state', payload);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0][0], 'state');
  assert.equal(repository.calls[0][1].commandId, 'cmd-1');
});

test('topic identity mismatch is rejected', async () => {
  const repository = repositorySpy();
  const service = new IngestionService(repository);
  const payload = Buffer.from(JSON.stringify({
    kind: 'device_status', schemaVersion: 1,
    siteId: 'other-site', deviceId: 'esp32-s3-01',
    messageId: 'status-1', recordedAt: '2026-08-17T06:00:00.000Z',
    online: true, mode: 'automatic',
  }));
  await assert.rejects(() => service.process('spff/v1/greenhouse-01/esp32-s3-01/status', payload));
  assert.equal(repository.calls.length, 0);
});

test('schedule sync acknowledgement is validated and stored', async () => {
  const repository = repositorySpy();
  const service = new IngestionService(repository);
  const payload = Buffer.from(JSON.stringify({
    kind: 'schedule_sync_ack',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    revision: 7,
    acknowledgedAt: '2026-08-28T15:20:00.000Z',
    status: 'applied',
    storedScheduleCount: 2,
  }));

  await service.process(
    'spff/v1/greenhouse-01/esp32-s3-01/ack',
    payload,
  );

  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0][0], 'schedule_ack');
  assert.equal(repository.calls[0][1].revision, 7);
});

test('automatic control acknowledgement is validated and stored', async () => {
  const repository = repositorySpy();
  const service = new IngestionService(repository);
  const payload = Buffer.from(JSON.stringify({
    kind: 'automatic_control_ack',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    revision: 9,
    acknowledgedAt: '2026-08-30T03:00:00.000Z',
    status: 'applied',
    appliedMode: 'automatic',
  }));
  await service.process(
    'spff/v1/greenhouse-01/esp32-s3-01/ack',
    payload,
  );
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0][0], 'automatic_control_ack');
  assert.equal(repository.calls[0][1].revision, 9);
});

test('device-origin session receives DB ACK only after saving to repository', async () => {
  const repository=repositorySpy();
  const service=new IngestionService(repository);
  const message={
    kind:'fertigation_session_event',schemaVersion:1,
    siteId:'greenhouse-01',deviceId:'esp32-s3-01',
    messageId:'session-event-1',sequence:1,
    sessionId:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
    recipeId:'e247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
    recordedAt:'2026-10-19T08:00:00.000Z',
    status:'started',targetWaterL:10,targetStockL:0,
    actualWaterL:0,actualStockL:0,pumpsOff:true,completionReason:null,
  };
  const ack=await service.process('spff/v1/greenhouse-01/esp32-s3-01/sessions',Buffer.from(JSON.stringify(message)));
  assert.equal(repository.calls[0][0],'session');
  assert.equal(ack.kind,'fertigation_session_persisted_ack');
  assert.equal(ack.messageId,message.messageId);
  await assert.rejects(()=>service.process('spff/v1/other-site/esp32-s3-01/sessions',Buffer.from(JSON.stringify(message))));
  assert.equal(repository.calls.length,1);
});
test('session persistence failure does not emit ACK',async()=>{
  const repository=repositorySpy();
  repository.saveFertigationSession=async()=>{throw new Error('database offline')};
  const service=new IngestionService(repository);
  const message={kind:'fertigation_session_event',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',
    sessionId:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',recipeId:'e247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
    messageId:'session-event-1',sequence:1,recordedAt:'2026-10-19T08:00:00.000Z',
    status:'started',targetWaterL:10,targetStockL:0,actualWaterL:0,actualStockL:0,pumpsOff:true,completionReason:null};
  await assert.rejects(()=>service.process('spff/v1/greenhouse-01/esp32-s3-01/sessions',Buffer.from(JSON.stringify(message))));
});

test('pulse OFF ACK requires matching topic, valid readback and durable store success',async()=>{
  const repository=repositorySpy(),acks=[];
  const service=new IngestionService(repository,undefined,async ack=>{acks.push(ack)});
  const ack={kind:'fertigation_pulse_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',
    sessionId:'00000000-0000-4000-8000-000000000001',commandId:'00000000-0000-4000-8000-000000000002',
    cycle:1,status:'completed',pumpsOff:true,reason:'pulse_duration_elapsed',acknowledgedAt:'2026-10-21T04:00:00Z'};
  const send=(value,topic='spff/v1/greenhouse-01/esp32-s3-01/ack')=>service.process(topic,Buffer.from(JSON.stringify(value)));
  await assert.rejects(send({...ack,pumpsOff:false}));
  await assert.rejects(send(ack,'spff/v1/other/esp32-s3-01/ack'));
  assert.equal(acks.length,0);
  assert.equal(await send(ack),null);assert.equal(acks.length,1);assert.equal(repository.calls.length,0);
  const broken=new IngestionService(repository,undefined,async()=>{throw new Error('DB unavailable')});
  await assert.rejects(broken.process('spff/v1/greenhouse-01/esp32-s3-01/ack',Buffer.from(JSON.stringify(ack))),/DB unavailable/);
});

test('interlock ACK comes from device, matches topic identity and awaits persistence',async()=>{
  const repository=repositorySpy(),acks=[];
  const service=new IngestionService(repository,undefined,undefined,async ack=>{acks.push(ack)});
  const ack={kind:'water_interlock_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',revision:1,
    status:'applied',appliedRevision:1,enabled:false,acknowledgedAt:'2026-10-21T06:00:00Z',reason:'applied'};
  const send=(value,topic='spff/v1/greenhouse-01/esp32-s3-01/ack')=>service.process(topic,Buffer.from(JSON.stringify(value)));
  await assert.rejects(send({...ack,appliedRevision:0}));
  await assert.rejects(send(ack,'spff/v1/other/esp32-s3-01/ack'));
  assert.equal(acks.length,0);await send(ack);assert.equal(acks.length,1);
  assert.equal(repository.calls.length,0);
});

test('adaptive events require topic identity and return database persistence acknowledgement only after save',async()=>{
 const {adaptiveEventPayloadSchema}=await import('@spff/contracts');const {createHash}=await import('node:crypto')
 const adaptiveEnvelope=raw=>{const payload=adaptiveEventPayloadSchema.parse(raw);return {kind:'adaptive_fert_event',schemaVersion:1,siteId:payload.siteId,deviceId:payload.deviceId,messageId:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),receivedAt:new Date().toISOString(),payload}}
 const repository=repositorySpy(),calls=[]
 const service=new IngestionService(repository,undefined,undefined,undefined,async event=>calls.push(event.messageId))
 const event=adaptiveEnvelope({kind:'adaptive_fert_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'',commandId:'',state:'IDLE',status:'rejected',acknowledgedAt:new Date().toISOString(),reason:'session_already_active'})
 const result=await service.process('spff/v1/greenhouse-01/esp32-s3-01/sessions',Buffer.from(JSON.stringify(event)))
 assert.equal(result.kind,'adaptive_fert_persisted_ack');assert.deepEqual(calls,[event.messageId])
 const frame=adaptiveEnvelope({kind:'adaptive_fert_telemetry',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'',timestamp:new Date().toISOString(),state:'IDLE',filteredEc:0,rawEc:2500,waterFlowLpm:0,fertFlowLpm:0,waterVolumeL:0,fertVolumeL:0,fertMassGrams:0,volumePerPlantMl:0,waterPump:false,fertPump:false,faultReason:'none',ecTargetUnreachable:false,ecValid:true,flowValid:true,ecAgeMs:100,flowAgeMs:100,waterPumpKnown:true,fertPumpKnown:true,volumeEstimated:false,targetEcUs:2500,bootId:'boot-1503',controlAlgorithm:'ec_hysteresis_ema',firmwareVersion:'1.5.03-SHT20-TELEMETRY-SYNC'})
 const stored=await service.process('spff/v1/greenhouse-01/esp32-s3-01/sessions',Buffer.from(JSON.stringify(frame)))
 assert.equal(stored.messageId,frame.messageId);assert.deepEqual(calls,[event.messageId,frame.messageId])
 await assert.rejects(service.process('spff/v1/other/esp32-s3-01/sessions',Buffer.from(JSON.stringify(event))))
 const failing=new IngestionService(repository,undefined,undefined,undefined,async()=>{throw Error('database down')})
 await assert.rejects(failing.process('spff/v1/greenhouse-01/esp32-s3-01/sessions',Buffer.from(JSON.stringify(event))),/database down/)
})
