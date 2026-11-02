import assert from 'node:assert/strict';
import test from 'node:test';
import { aiPumpSimulationSchema, isPumpCommandMessage } from '@spff/contracts';
import { prepareAiPumpSimulation } from '../lib/services/aiPumpSimulation.js';
import { runAiPumpLoopbackSimulation } from '../../scripts/ai-pump-loopback-simulation.mjs';

function sample(overrides={}) {
  return {
    schemaVersion: 1, mode: 'SHADOW_MODE', can_dispatch: false,
    status: 'STALE', planning_source: 'POSTGRES_READ_ONLY',
    planning_status: 'CURRENT',
    evaluated_at: '2026-11-01T10:46:56.258014+00:00',
    planning_recorded_at: '2026-11-02T05:36:35+00:00',
    decision: { type: 'HOLD', proposed_action:'FERTIGATE', hold_reasons: ['manual_mode_blocks_automatic_start'], configuration_version: null },
    sensors: { device_mode: 'manual' },
    tank_preview: { level_status: 'NO_DATA' },
    fertilizer_tank_preview: { level_status: 'NO_DATA' },
    feedback: { status:'STALE', reported_off:false, boot_matches:false, water_pump:null, fert_pump:null },
    calculation: { water_l:null, duration_seconds:null },
    flow_reference: { basis: 'UNVERIFIED_HISTORICAL_COUNTER_DELTAS' },
    fuzzy_preview_blockers: [],
    fuzzy_preview: {
      basis: 'SIMULATION_PROFILE', input_key: 'soil_2_moisture',
      illustrative_water_l: 372.68072660731696,
      recorded_at: '2026-11-02T05:36:35+00:00',
    },
    ...overrides,
  };
}

test('Fuzzy liters convert into a bounded mock water-trial candidate, never a dispatch grant',()=>{
  const result=prepareAiPumpSimulation(sample());
  assert.equal(aiPumpSimulationSchema.safeParse(result).success,true);
  assert.equal(result.mockCandidate.targetWaterL,100);
  assert.equal(result.mockCandidate.deferredWaterL,272.68);
  assert.equal(result.mockCandidate.durationSec,60);
  assert.equal(result.mockCandidate.durationBasis,'FIXED_MOCK_TIMEBOX_NOT_HYDRAULIC');
  assert.equal(result.commandCreated,false);
  assert.equal(result.canDispatch,false);
  assert.ok(result.dispatchBlockers.includes('AI_DECISION_ON_HOLD'));
});

test('stale sensor, snapshot mismatch and missing Fuzzy fail closed for mock candidate',()=>{
  for(const changed of [
    {planning_status:'STALE'},
    {planning_source:'DECISION_SNAPSHOT'},
    {fuzzy_preview_blockers:['sensor_raw_poll_not_verified']},
    {planning_recorded_at:'2026-11-02T05:30:00+00:00'},
    {fuzzy_preview:null},
    {fuzzy_preview:{basis:'SIMULATION_PROFILE',input_key:'soil_2_moisture',illustrative_water_l:0.5,recorded_at:'2026-11-02T05:36:35+00:00'}},
  ]){
    const result=prepareAiPumpSimulation(sample(changed));
    assert.equal(result.mockCandidate,null);
    assert.ok(result.mockBlockers.length>0);
    assert.equal(result.canDispatch,false);
  }
});

test('real worker dispatch class and ACK ingestion validator complete MOCK lifecycle only',async()=>{
  const {mockCommand,mockLifecycle,...result}=await runAiPumpLoopbackSimulation(sample());
  assert.equal(result.transport,'IN_MEMORY_ONLY');
  assert.equal(result.physicalAckReceived,false);
  assert.equal(result.physicalWaterDeliveredL,null);
  assert.equal(result.mockFinalState,'MOCK_COMPLETED_NOT_DEVICE_PROOF');
  assert.equal(isPumpCommandMessage(mockCommand),true);
  assert.equal(mockCommand.siteId,'simulated-site');
  assert.equal(mockCommand.deviceId,'simulated-esp32');
  assert.equal(mockCommand.params.waterTrial.targetWaterL,100);
  assert.deepEqual(mockLifecycle.map(x=>x.event),[
    'MOCK_QUEUE_PENDING','MOCK_WORKER_PUBLISHED','MOCK_ACK_ACCEPTED','MOCK_ACK_COMPLETED_OFF',
  ]);
  assert.equal(mockCommand.params.waterTrial.durationSec,60);
});

test('no trustworthy preview means no synthetic command or fake ACK',async()=>{
  const result=await runAiPumpLoopbackSimulation(sample({fuzzy_preview:null}));
  assert.equal(result.mockCommand,null);
  assert.deepEqual(result.mockLifecycle,[]);
  assert.equal(result.physicalAckReceived,false);
  assert.equal(result.plan.commandCreated,false);
});
