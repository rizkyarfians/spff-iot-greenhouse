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
