import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPumpCommandMessage, mqttTopics, aiVolumeTrialPreviewSchema,
} from '@spff/contracts';
import { convertAiFuzzyToSoftwareTrial } from '../lib/services/aiVolumeTrialConversion.js';
import { IngestionService } from '../../mqtt-worker/dist/ingestionService.js';

function shadowFixture(now) {
  const recordedAt=now.toISOString();
  return {
    mode:'SHADOW_MODE',can_dispatch:false,status:'STALE',
    planning_source:'POSTGRES_READ_ONLY',planning_status:'CURRENT',
    planning_recorded_at:recordedAt,fuzzy_preview_blockers:[],
    fuzzy_preview:{
      basis:'SIMULATION_PROFILE',config_version:'simulation-1',
      input_key:'soil_2_moisture',moisture_pct:29,score:0.7453614532146339,
      illustrative_water_l:372.68072660731696,model_max_irrigation_l:500,
      recorded_at:recordedAt,
    },
    sensors:{recorded_at:recordedAt,control_moisture_source:'soil_2_moisture'},
    decision:{type:'HOLD',proposed_action:'FERTIGATE',hold_reasons:[]},
  };
}

async function runSoftwarePipeline(summary, now=new Date()) {
  // The dispatcher's config validates DATABASE_URL at import; this dummy value
  // is never opened because the test injects an in-memory repository.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/ai_test_only';
  const { CommandDispatchService } = await import('../../mqtt-worker/dist/commandDispatchService.js');
  const draft=convertAiFuzzyToSoftwareTrial(summary,
    {deviceId:'esp32-s3-01',trialCapL:5,durationSec:30},now);
  assert.equal(aiVolumeTrialPreviewSchema.safeParse(draft).success,true);

  // Synthetic queue ONLY. No Postgres, actual Mosquitto, Edge, or MCU connection.
  const commandId='ai-software-test-0001';
  const pending={
    commandId,siteId:'ai-software-test-only',deviceId:draft.commandCandidate.deviceId,
    actuatorKey:draft.commandCandidate.targetId,requestedIsActive:true,
    requestedBy:'trial:water:software-only',issuedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+15000).toISOString(),
    waterTrial:draft.commandCandidate.params.waterTrial,
  };
  const stored={status:'pending',ackIds:new Set(),ackCount:0};
  const messages=[];
  const repo={
    async expireCommands(){return 0;},
    async pendingCommands(){return stored.status==='pending'?[pending]:[];},
    async markCommandPublished(id){assert.equal(id,commandId);stored.status='published';},
  };
  const publisher={
    async publishCommand(wire) {
      assert.equal(isPumpCommandMessage(wire),true);
      messages.push({
        topic:mqttTopics.commands(wire.siteId,wire.deviceId),
        qos:1,retain:false,payload:JSON.stringify(wire),
      });
    },
  };
  const dispatcher=new CommandDispatchService(repo,publisher);
  await dispatcher.runOnce();
  assert.equal(stored.status,'published');
  assert.equal(messages.length,1);
  const payload=JSON.parse(messages[0].payload);
  assert.equal(payload.params.waterTrial.targetWaterL,5);
  assert.equal(payload.params.waterTrial.durationSec,30);
  assert.equal(payload.commandId,commandId);

  const ingester=new IngestionService({
    async saveAcknowledgement(ack) {
      if (ack.commandId!==commandId||ack.siteId!==pending.siteId||
          ack.deviceId!==pending.deviceId||ack.targetId!=='pump_water') return;
      // Model the existing SQL guard: completed trial requires device-reported OFF.
      if (ack.status==='completed' && ack.actualState?.isActive!==false) return;
      const key=JSON.stringify(ack);
      if(stored.ackIds.has(key))return;
      stored.ackIds.add(key);
      stored.ackCount++;
      if(ack.status==='accepted' && stored.status==='published')stored.status='accepted';
      if(ack.status==='completed' && !['completed','rejected','timed_out'].includes(stored.status)){
        stored.status='completed';
      }
    },
  });
  const topic=mqttTopics.acknowledgements(pending.siteId,pending.deviceId);
  const send=async (status,actualState,actualWaterL) => {
    const frame={kind:'command_ack',schemaVersion:1,
      siteId:pending.siteId,deviceId:pending.deviceId,commandId,
      acknowledgedAt:new Date(now.getTime()+1000).toISOString(),
      status,targetId:'pump_water',
      actualState,reason:'trial_volume_reached',actualWaterL,elapsedSec:15};
    const encoded=Buffer.from(JSON.stringify(frame));
    await ingester.process(topic,encoded);
    return encoded;
  };
  assert.equal(stored.status,'published');
  await send('accepted',{isActive:true},0);
  assert.equal(stored.status,'accepted');
  const rejectedByGuard=await send('completed',{isActive:true},5);
  assert.equal(stored.status,'accepted');
  const completed=await send('completed',{isActive:false},5);
  assert.equal(stored.status,'completed');
  await ingester.process(topic,completed);
  assert.equal(stored.ackCount,2,'duplicate QoS1 ACK is idempotent');
  assert.ok(stored.ackIds.size===2);
  assert.equal(messages[0].qos,1);
  assert.equal(messages[0].retain,false);
  assert.equal(rejectedByGuard instanceof Uint8Array,true);
  return {sourceVolumeL:draft.source.illustrativeWaterL,
    trialVolumeL:draft.conversion.targetWaterL,timeoutSec:draft.conversion.durationSec,
    commandId,topic:messages[0].topic,ackTopic:topic,finalSimulatedStatus:stored.status,
    simulatedAckCount:stored.ackCount,canDispatch:draft.canDispatch};
}

test('Mamdani result → bounded command → mocked QoS1 MQTT → simulated ACK to ingestion',async()=>{
  const r=await runSoftwarePipeline(shadowFixture(new Date()));
  assert.equal(r.finalSimulatedStatus,'completed');
  assert.equal(r.canDispatch,false);
  assert.equal(r.trialVolumeL,5);
});

test('optional live Python SHADOW source → simulated command/ACK (never pumps)',{
  skip:process.env.SPFF_TEST_LIVE_AI_SHADOW!=='true',
},async()=>{
  const response=await fetch('http://127.0.0.1:5011/dashboard/summary',{
    signal:AbortSignal.timeout(15000),
  });
  assert.equal(response.ok,true);
  const {unifiedAiDashboardSchema}=await import('@spff/contracts');
  const summary=unifiedAiDashboardSchema.parse(await response.json());
  const r=await runSoftwarePipeline(summary);
  console.log('LIVE AI → SOFTWARE-ONLY PIPELINE:',JSON.stringify(r));
});
