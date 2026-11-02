import test from 'node:test';
import assert from 'node:assert/strict';
import { aiVolumeTrialPreviewSchema } from '@spff/contracts';
import { convertAiFuzzyToSoftwareTrial } from '../lib/services/aiVolumeTrialConversion.js';

export function summaryFixture(now = new Date()) {
  const ts = now.toISOString();
  return {
    mode: 'SHADOW_MODE',
    can_dispatch: false,
    status: 'STALE',
    planning_source: 'POSTGRES_READ_ONLY',
    planning_status: 'CURRENT',
    planning_recorded_at: ts,
    fuzzy_preview_blockers: [],
    fuzzy_preview: {
      basis:'SIMULATION_PROFILE',
      config_version:'simulation-1',
      input_key:'soil_2_moisture',
      moisture_pct:29,
      score:0.7453614532146339,
      illustrative_water_l:372.68072660731696,
      model_max_irrigation_l:500,
      recorded_at:ts,
    },
    sensors:{recorded_at:ts,control_moisture_source:'soil_2_moisture'},
    decision:{type:'HOLD',proposed_action:'FERTIGATE',hold_reasons:['manual_mode_blocks_automatic_start']},
  };
}

test('real Fuzzy 372.68L converts into 5L operator-capped non-dispatchable water trial', () => {
  const now = new Date();
  const result = convertAiFuzzyToSoftwareTrial(
    summaryFixture(now),{deviceId:'esp32-s3-01',trialCapL:5,durationSec:30},now,
  );
  assert.equal(aiVolumeTrialPreviewSchema.safeParse(result).success,true);
  assert.equal(result.source.illustrativeWaterL,372.68072660731696);
  assert.equal(result.conversion.targetWaterL,5);
  assert.equal(result.conversion.durationSec,30);
  assert.equal(result.conversion.capped,true);
  assert.equal(result.source.proposedAction,'FERTIGATE');
  assert.equal(result.commandCandidate.params.waterTrial.targetWaterL,5);
  assert.equal(result.canDispatch,false);
  assert.equal(result.commandCreated,false);
  assert.equal(result.mqttPublished,false);
  assert.equal('commandId' in result.commandCandidate,false);
  assert.equal('issuedAt' in result.commandCandidate,false);
});

test('source lower than operator cap retains actual Fuzzy result without exceeding source', () => {
  const now=new Date();
  const source=summaryFixture(now);
  source.fuzzy_preview.illustrative_water_l=2.345678;
  const result=convertAiFuzzyToSoftwareTrial(source,{deviceId:'esp32-s3-01',trialCapL:5,durationSec:15},now);
  assert.equal(result.conversion.targetWaterL,2.345);
  assert.equal(result.conversion.capped,true);
});

test('fails closed for stale, mismatched, blocked, or insufficient SHADOW planning', () => {
  const now=new Date();
  const input={deviceId:'esp32-s3-01',trialCapL:5,durationSec:30};
  for(const patch of [
    {planning_status:'STALE'},
    {planning_source:'DECISION_SNAPSHOT'},
    {fuzzy_preview_blockers:['sensor_raw_poll_not_verified']},
    {fuzzy_preview:null},
    {planning_recorded_at:'2026-01-01T00:00:00Z'},
    {sensors:{recorded_at:'2026-01-01T00:00:00Z',control_moisture_source:'soil_2_moisture'}},
    {mode:'ACTIVE'},
  ]) assert.throws(()=>convertAiFuzzyToSoftwareTrial({...summaryFixture(now),...patch},input,now));
  const old=summaryFixture(now);
  old.fuzzy_preview.recorded_at='2026-01-01T00:00:00Z';
  old.planning_recorded_at=old.fuzzy_preview.recorded_at;
  old.sensors.recorded_at=old.fuzzy_preview.recorded_at;
  assert.throws(()=>convertAiFuzzyToSoftwareTrial(old,input,now));
});

test('requires explicit bounded operator trial cap and timeout', () => {
  const now=new Date();
  for(const request of [
    {deviceId:'esp32-s3-01',trialCapL:100.1,durationSec:30},
    {deviceId:'esp32-s3-01',trialCapL:0.5,durationSec:30},
    {deviceId:'esp32-s3-01',trialCapL:5,durationSec:61},
    {deviceId:'esp32-s3-01',trialCapL:5,durationSec:4},
  ]) assert.throws(()=>convertAiFuzzyToSoftwareTrial(summaryFixture(now),request,now));
  const ok=convertAiFuzzyToSoftwareTrial(summaryFixture(now),
    {deviceId:'esp32-s3-01',trialCapL:100,durationSec:60},now);
  assert.equal(ok.conversion.targetWaterL,100);
  assert.equal(aiVolumeTrialPreviewSchema.safeParse({...ok,canDispatch:true}).success,false);
  assert.equal(aiVolumeTrialPreviewSchema.safeParse({...ok,mqttPublished:true}).success,false);
});
