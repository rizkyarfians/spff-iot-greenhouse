import test from 'node:test';
import assert from 'node:assert/strict';
import { previewAutomaticProgram } from '../lib/services/fertigationAutomaticPreview.js';

const now = new Date('2026-10-18T10:00:00Z');
const recipe = {
  recipeId:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26', siteId:'greenhouse-01',
  zoneId:'soil-1', cropId:'sweet-potato', cropName:'Ubi Jalar',
  hstFrom:10,hstTo:50,targetWaterL:10,targetStockL:0,
  fertilizerName:null,stockConcentrationGPerL:null,minWaterTankPercent:20,minStockTankPercent:20,
  sourceReference:'AGR approved',approvalStatus:'approved',approvalReference:'AGR-1',
  approvedBy:'admin',approvedAt:now.toISOString(),plantingDate:'2026-09-18',
  applicationDate:'2026-10-18',revision:2,updatedAt:now.toISOString(),
  moistureLowPercent:30,moistureTargetPercent:50,
  ecLowUsCm:null,ecTargetUsCm:null,ecHighUsCm:null,
};
const snapshot={
  telemetryRecordedAt:new Date('2026-10-18T09:59:55Z'),deviceRecordedAt:new Date('2026-10-18T09:59:55Z'),
  deviceOnline:true,deviceMode:'automatic',automaticMode:'automatic',appliedMode:'automatic',
  configRevision:2,acknowledgedRevision:2,acknowledgementStatus:'applied',
  actualWaterLpm:0,actualStockLpm:0,waterTankPercent:75,stockTankPercent:65,
  flowWaterValid:true,flowStockValid:true,waterTankValid:true,stockTankValid:true,
  activeCropId:'sweet-potato',moistureSensorKey:'soil_1_moisture',
  moisture:20,moistureValid:true,moistureLowPercent:30,moistureTargetPercent:50,
  liquidEcUsCm:350,liquidEcValid:true,ecLowUsCm:500,ecHighUsCm:1100,
};
test('preview is never activated or dispatched',()=>{
  const result=previewAutomaticProgram(recipe,'esp32-s3-01',snapshot,now);
  assert.equal(result.status,'ready_for_review');
  assert.equal(result.activeStrategy,'legacy_sensor');
  assert.equal(result.proposedStrategy,'program_volume');
  assert.equal(result.canActivate,false);
});
test('missing program moisture thresholds must hold',()=>{
  const result=previewAutomaticProgram({...recipe,moistureLowPercent:null},'esp32-s3-01',snapshot,now);
  assert.equal(result.status,'hold');
});
test('fertilization needs program EC thresholds, not legacy defaults',()=>{
  const fert={...recipe,targetStockL:1,fertilizerName:'NPK',stockConcentrationGPerL:100};
  assert.equal(previewAutomaticProgram(fert,'esp32-s3-01',snapshot,now).status,'hold');
  const withEc={...fert,ecLowUsCm:400,ecTargetUsCm:700,ecHighUsCm:1000};
  assert.equal(previewAutomaticProgram(withEc,'esp32-s3-01',snapshot,now).status,'ready_for_review');
  assert.equal(previewAutomaticProgram(withEc,'esp32-s3-01',{...snapshot,liquidEcUsCm:1200},now).status,'hold');
});
test('failed crop, telemetry and acknowledgement checks hold',()=>{
  assert.equal(previewAutomaticProgram(recipe,'esp32-s3-01',{...snapshot,activeCropId:'tomato'},now).status,'hold');
  assert.equal(previewAutomaticProgram(recipe,'esp32-s3-01',{...snapshot,deviceOnline:false},now).status,'hold');
  assert.equal(previewAutomaticProgram(recipe,'esp32-s3-01',{...snapshot,acknowledgedRevision:1},now).status,'hold');
});
