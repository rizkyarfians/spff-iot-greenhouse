import assert from 'node:assert/strict';
import test from 'node:test';
import { aiAutomaticPumpReadinessSchema } from '@spff/contracts';
import { assessAutomaticAiPumpReadiness } from '../lib/services/aiAutomaticPumpReadiness.js';

const ai=(mode='automatic', status='CURRENT', hold=false)=>({
  mode:'SHADOW_MODE',can_dispatch:false,status,
  decision:{type:hold?'HOLD':'IRRIGATE',hold_reasons:hold?['not_ready']:[],proposed_action:'IRRIGATE',configuration_version:'rev1'},
  sensors:{device_mode:mode},
});
const evidence=(mode='automatic')=>({
  deviceEnabled:true,deviceOnline:true,deviceMode:mode,
  statusRecordedAt:new Date(),
  firmwareVersion:'1.5.03-SHT20-TELEMETRY-SYNC',
  desiredMode:'automatic',appliedMode:'automatic',autoAckStatus:'applied',
  revision:'2',acknowledgedRevision:'2',waterEnabled:true,competingCommand:false,
});

test('even matching automatic mode is preview only: firmware 1.5.03 rejects AI ON',()=>{
  const result=assessAutomaticAiPumpReadiness(ai(),evidence(),'esp32-s3-01');
  assert.equal(aiAutomaticPumpReadinessSchema.safeParse(result).success,true);
  assert.equal(result.canDispatch,false);
  assert.equal(result.commandCreated,false);
  assert.equal(result.commandType,'set_pump');
  assert.equal(result.actualMode,'automatic');
  assert.deepEqual(result.blockers,['AI_SHADOW_NOT_EXECUTION_AUTHORITY','FIRMWARE_AUTO_AI_ON_UNSUPPORTED']);
  assert.equal(aiAutomaticPumpReadinessSchema.safeParse({...result,canDispatch:true}).success,false);
});

test('manual mode on device OR AI source prevents automatic AI control',()=>{
  const manualDevice=assessAutomaticAiPumpReadiness(ai(),evidence('manual'),'esp32-s3-01');
  assert.ok(manualDevice.blockers.includes('DEVICE_NOT_AUTOMATIC'));
  const manualAi=assessAutomaticAiPumpReadiness(ai('manual'),evidence(),'esp32-s3-01');
  assert.ok(manualAi.blockers.includes('AI_SOURCE_NOT_AUTOMATIC'));
});

test('unacknowledged mode, stale status, HOLD and command conflict each block',()=>{
  const base=evidence();
  const result=assessAutomaticAiPumpReadiness(ai('automatic','STALE',true),{
    ...base,autoAckStatus:'rejected',acknowledgedRevision:'1',
    statusRecordedAt:new Date(Date.now()-120000),competingCommand:true,waterEnabled:false,
  },'esp32-s3-01');
  for(const code of ['AI_DECISION_NOT_CURRENT','AI_DECISION_HOLD','DEVICE_NOT_ONLINE_FRESH',
    'AUTO_CONFIG_NOT_ACKNOWLEDGED','AUTO_WATER_NOT_ENABLED','COMPETING_COMMAND_IN_FLIGHT']){
    assert.ok(result.blockers.includes(code),code);
  }
});
