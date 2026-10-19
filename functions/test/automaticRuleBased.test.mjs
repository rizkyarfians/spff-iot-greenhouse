import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAutomaticRuleBased } from '../lib/services/automaticRuleBased.js';

const now = new Date('2026-10-18T10:00:00Z');
const program = {
  recipeId:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',siteId:'greenhouse-01',
  cropId:'sweet-potato',zoneId:'soil-1',cropName:'Ubi Jalar',
  approvalStatus:'approved',approvalReference:'AGR-1',plantingDate:'2026-09-18',
  applicationDate:'2026-10-18',hstFrom:10,hstTo:50,
  minWaterTankPercent:20,minStockTankPercent:20,targetWaterL:15,targetStockL:0,
  moistureLowPercent:30,moistureTargetPercent:50,
  ecLowUsCm:null,ecTargetUsCm:null,ecHighUsCm:null,
};
const snapshot = {
  activeCropId:'sweet-potato',telemetryRecordedAt:new Date('2026-10-18T09:59:55Z'),
  deviceRecordedAt:new Date('2026-10-18T09:59:55Z'),deviceOnline:true,
  deviceMode:'automatic',automaticMode:'automatic',appliedMode:'automatic',
  configRevision:2,acknowledgedRevision:2,acknowledgementStatus:'applied',
  waterTankPercent:70,stockTankPercent:60,waterTankValid:true,stockTankValid:true,
  flowWaterValid:true,flowStockValid:true,moistureSensorKey:'soil_1_moisture',
  moisture:20,moistureValid:true,moistureLowPercent:30,moistureTargetPercent:50,
  liquidEcUsCm:400,liquidEcValid:true,ecLowUsCm:500,ecHighUsCm:1200,
};
const run=(p,s=snapshot)=>evaluateAutomaticRuleBased(p,'esp32-s3-01',s,now);

const sensorProgram={...program,applicationMode:'sensor',applicationDate:null,applicationIntervalDays:null,triggerSampleCount:3};
const history=()=>[5,35,65].map(seconds=>({recordedAt:new Date(now.getTime()-seconds*1000),
  moisture:30,moistureValid:true,ec:400,ecValid:true}));
test('sensor rules stay eligible across days by HST with no application date or interval',()=>{
  const nextDay=new Date(now.getTime()+86400000);
  const current={...snapshot,moisture:30,recentSamples:history()};
  assert.equal(run([sensorProgram],current).status,'suggested');
  const shifted={...current,telemetryRecordedAt:new Date(snapshot.telemetryRecordedAt.getTime()+86400000),
    deviceRecordedAt:new Date(snapshot.deviceRecordedAt.getTime()+86400000),
    recentSamples:history().map(s=>({...s,recordedAt:new Date(s.recordedAt.getTime()+86400000)}))};
  assert.equal(evaluateAutomaticRuleBased([sensorProgram],'esp32-s3-01',shifted,nextDay).status,'suggested');
  assert.equal(run([{...sensorProgram,hstTo:29}],current).eligibleCount,0);
});
test('moisture must be at or below minimum for distinct fresh consecutive samples',()=>{
  const current={...snapshot,moisture:30,recentSamples:history()};
  assert.equal(run([sensorProgram],current).status,'suggested');
  for(const samples of [[],history().slice(0,2),[history()[0],history()[0],history()[0]],
    history().map((s,i)=>i===1?{...s,moisture:31}:s),
    history().map((s,i)=>i===1?{...s,moistureValid:false}:s),
    history().map((s,i)=>i===2?{...s,recordedAt:new Date(now.getTime()-121000)}:s)]) {
    assert.equal(run([sensorProgram],{...current,recentSamples:samples}).status,'hold');
  }
  assert.equal(run([sensorProgram],{...current,moisture:31}).status,'hold');
  assert.equal(run([sensorProgram],current).canDispatch,false);
});
test('fertilizer confirmation also needs consecutive EC readings below rule threshold',()=>{
  const fert={...sensorProgram,targetStockL:1,ecLowUsCm:500,ecTargetUsCm:800,ecHighUsCm:1000};
  assert.equal(run([fert],{...snapshot,recentSamples:history()}).action,'FERTIGATE');
  for(const fault of [{ec:600},{ecValid:false},{ec:null}]) {
    const samples=history().map((s,i)=>i===1?{...s,...fault}:s);
    assert.equal(run([fert],{...snapshot,recentSamples:samples}).status,'hold');
  }
});
test('rule demand thresholds are independent of missing or stricter legacy thresholds',()=>{
  for (const legacy of [null, 10, 90]) {
    const result=run([program],{...snapshot,moistureLowPercent:legacy,moistureTargetPercent:legacy});
    assert.equal(result.status,'suggested');
    assert.equal(result.canDispatch,false);
  }
  assert.equal(run([program],{...snapshot,moisture:35,moistureLowPercent:90}).status,'hold');
});
test('fertilizer uses rule EC thresholds without requiring legacy EC settings',()=>{
  const fert={...program,targetStockL:1,ecLowUsCm:500,ecTargetUsCm:800,ecHighUsCm:1000};
  for (const legacy of [null, 100]) {
    assert.equal(run([fert],{...snapshot,ecLowUsCm:legacy,ecHighUsCm:legacy}).action,'FERTIGATE');
  }
  assert.equal(run([fert],{...snapshot,liquidEcUsCm:1100}).status,'hold');
});
test('rule-based still enforces safety when legacy demand settings are absent',()=>{
  const base={...snapshot,moistureLowPercent:null,moistureTargetPercent:null};
  for (const fault of [
    {moistureValid:false}, {flowWaterValid:false}, {waterTankPercent:0},
    {acknowledgedRevision:1}, {deviceMode:'manual'}, {deviceOnline:false},
    {telemetryRecordedAt:new Date('2026-10-17T00:00:00Z')},
  ]) assert.equal(run([program],{...base,...fault}).status,'hold');
});
test('one approved profile is chosen automatically with no MQTT dispatch',()=>{
  const output=run([program]);assert.equal(output.status,'suggested');
  assert.equal(output.action,'IRRIGATE');assert.equal(output.canDispatch,false);
  assert.equal(output.selectedProgramId,program.recipeId);
  assert.equal(output.activeDeviceStrategy,'legacy_sensor');
});
test('zero or multiple valid profiles fail closed',()=>{
  assert.equal(run([]).status,'hold');assert.equal(run([program,program]).status,'hold');
  assert.equal(run([{...program,approvalStatus:'draft'}]).status,'hold');
});
test('crop mismatch, old sensor and missing agronomic threshold fail closed',()=>{
  assert.equal(run([program],{...snapshot,activeCropId:'tomato'}).status,'hold');
  assert.equal(run([program],{...snapshot,deviceOnline:false}).status,'hold');
  assert.equal(run([{...program,moistureLowPercent:null}]).status,'hold');
});
