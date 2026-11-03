import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAccWaterTrialRequestSchema } from '@spff/contracts';
import { planAiAccWaterTrial } from '../lib/services/aiAccWaterTrialPolicy.js';

const now = new Date('2026-11-03T07:00:20Z');
const at = '2026-11-03T07:00:10Z';
const request = {
  deviceId:'esp32-s3-01',commandId:'135c5802-83fb-428c-bdb2-1153bc364781',
  expectedAction:'IRRIGATE', expectedEvaluatedAt:at, trialCapL:2,
  durationSec:10, confirmation:'APPROVE_AI_WATER_ONLY_TRIAL'
};
function source(patch={}) {
  return {
    status:'CURRENT',evaluated_at:at,
    planning_source:'POSTGRES_READ_ONLY',planning_status:'CURRENT',
    planning_recorded_at:at,
    decision:{type:'IRRIGATE',proposed_action:'IRRIGATE',hold_reasons:[]},
    sensors:{device_mode:'automatic',recorded_at:at,
      control_moisture_source:'soil_2_moisture',soil_1_valid:false,soil_2_valid:true},
    tank_preview:{sensor_valid:true,reported_level_pct:80},
    feedback:{status:'REPORTED_OFF_FRESH',reported_off:true,boot_matches:true,
      water_pump:false,fert_pump:false,reported_at:at},
    calculation:{water_l:20},
    fuzzy_preview_blockers:[],flow_reference:null,
    ...patch,
  };
}
test('ACC request binds operator-reviewed fresh source, water-only cap',()=>{
  assert.equal(aiAccWaterTrialRequestSchema.safeParse(request).success,true);
  const result=planAiAccWaterTrial(source(),request,now);
  assert.equal(result.targetWaterL,2);
  assert.equal(result.durationSec,10);
  assert.equal(result.plannedWaterL,20);
});
test('block stale, HOLD, source change, missing level, unverified flow and missing real plan',()=>{
  const changes=[
    {status:'STALE'},
    {decision:{type:'HOLD',proposed_action:'IRRIGATE',hold_reasons:['fault']}},
    {evaluated_at:'2026-11-03T06:00:10Z'},
    {planning_status:'STALE'},
    {sensors:{...source().sensors,device_mode:'manual'}},
    {tank_preview:{sensor_valid:false,reported_level_pct:null}},
    {feedback:{...source().feedback,reported_off:false}},
    {flow_reference:{basis:'UNVERIFIED_HISTORICAL_COUNTER_DELTAS'}},
    {calculation:{water_l:null}},
    {fuzzy_preview_blockers:['sensor_raw_poll_not_verified']},
  ];
  for(const patch of changes) assert.throws(()=>planAiAccWaterTrial(source(patch),request,now),JSON.stringify(patch));
});
test('invalid cap/duration and fabricated approval rejected by schema',()=>{
  for(const patch of [{trialCapL:25},{durationSec:61},{confirmation:'yes'},{deviceId:''}]){
    assert.equal(aiAccWaterTrialRequestSchema.safeParse({...request,...patch}).success,false);
  }
});
