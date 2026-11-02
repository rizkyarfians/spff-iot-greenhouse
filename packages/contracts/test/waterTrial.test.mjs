import test from 'node:test';
import assert from 'node:assert/strict';
import {
  waterTrialRequestSchema, waterTrialCalibrationSchema, isPumpCommandMessage,
} from '../dist/index.js';

const request = {
  commandId:'water-trial-0001', deviceId:'esp32-s3-01',
  targetWaterL:10, durationSec:30, confirmation:'RUN_CALIBRATION_TRIAL',
};
test('water trial must be manually confirmed and narrowly bounded',()=>{
  assert.equal(waterTrialRequestSchema.safeParse(request).success,true);
  for(const patch of [
    {confirmation:'yes'}, {durationSec:0},{durationSec:61},
    {durationSec:1.5},{targetWaterL:0},{targetWaterL:101},
    {targetWaterL:Infinity},{deviceId:''},
  ]) assert.equal(waterTrialRequestSchema.safeParse({...request,...patch}).success,false);
});
test('only water pump manual trial ON can include timing',()=>{
  const command={
    kind:'command',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',
    commandId:request.commandId,issuedAt:'2026-11-02T03:30:00Z',
    expiresAt:'2026-11-02T03:30:15Z',requestedBy:'trial:water:admin',
    type:'set_pump',targetId:'pump_water',
    params:{isActive:true,waterTrial:{durationSec:30,targetWaterL:10}},
  };
  assert.equal(isPumpCommandMessage(command),true);
  for(const patch of [
    {targetId:'pump_fert'},{requestedBy:'dashboard:admin'},
    {params:{...command.params,isActive:false}},
    {params:{...command.params,waterTrial:{durationSec:999,targetWaterL:10}}},
    {params:{...command.params,waterTrial:{durationSec:30,targetWaterL:Infinity}}},
  ]) assert.equal(isPumpCommandMessage({...command,...patch}),false);
  const manual={...command,requestedBy:'dashboard:admin',params:{isActive:true}};
  assert.equal(isPumpCommandMessage(manual),true);
});
test('physical calibration requires positive measured volume',()=>{
  assert.equal(waterTrialCalibrationSchema.safeParse({physicalMeasuredL:10,note:'ukur dengan wadah'}).success,true);
  for(const v of [0,-1,Infinity,NaN,'10'])
    assert.equal(waterTrialCalibrationSchema.safeParse({physicalMeasuredL:v}).success,false);
});
