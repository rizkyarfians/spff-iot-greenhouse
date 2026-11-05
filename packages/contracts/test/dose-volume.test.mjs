import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDoseVolume,doseVolumeCapabilitySchema,doseVolumeStartSchema,doseVolumePlanRequestSchema,
 adaptiveDispatchSchema,adaptiveFirmware1507StartSchema,doseVolumeApproveSchema} from '../dist/index.js';
const limits={contract:'spff-dose-volume-v1',commissioned:true,configVersion:'test',measuredTotalizers:true,
 waterMeterPosition:'before_injector',waterStopPct:5,stockStopPct:2,primeWaterL:5,flushWaterL:10,
 minWaterFlowLpm:1,minStockFlowLpm:0.1,maxDurationSec:600,maxWaterL:5000,maxStockL:500,meterToleranceL:0.01};
function start(){const issued=new Date();return {kind:'dose_volume_command',schemaVersion:1,contract:'spff-dose-volume-v1',
 siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'11111111-1111-4111-8111-111111111111',commandId:'22222222-2222-4222-8222-222222222222',
 commandType:'start',controlAlgorithm:'guide_dose_volume_v1',mode:'fertigation',planId:'33333333-3333-4333-8333-333333333333',
 bootId:'0123456789abcdef',issuedAt:issued.toISOString(),expiresAt:new Date(issued.getTime()+15000).toISOString(),
 targetWaterVolumeL:2250,targetStockVolumeL:90,nominalConcentrationGPerL:4,targetMassG:360,limits};}
test('Guide dose is a prepared batch; low-level reserve leaves an explicit remaining mass',()=>{
 const result=calculateDoseVolume({mode:'fertigation',remainingG:400,waterAvailableL:2500,waterCapacityL:5000,stockAvailableL:100,stockCapacityL:500,limits});
 assert.equal(result.batchMassG,400);assert.equal(result.targetStockL,90);assert.equal(result.plannedMassG,360);
 assert.equal(result.remainingAfterSessionG,40);assert.equal(result.targetWaterL,2250);
});
test('missing commissioning parameters cannot be replaced by simulator defaults',()=>{
 const result=calculateDoseVolume({mode:'fertigation',remainingG:400,waterAvailableL:2500,waterCapacityL:5000,stockAvailableL:100,stockCapacityL:500,limits:null});
 assert.equal(result.targetWaterL,null);assert.equal(result.targetStockL,null);
 assert.equal(doseVolumeCapabilitySchema.safeParse({...limits,commissioned:false}).success,false);
});
test('volume START travels through typed outbox but cannot be parsed as an old EC command',()=>{
 const command=start();assert.equal(doseVolumeStartSchema.safeParse(command).success,true);
 assert.equal(adaptiveFirmware1507StartSchema.safeParse(command).success,false);
 assert.equal(adaptiveDispatchSchema.safeParse({kind:'adaptive_fert_dispatch',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,
  command,expiresAt:command.expiresAt}).success,true);
 assert.equal(doseVolumeStartSchema.safeParse({...command,targetEcUs:1200}).success,false);
 assert.equal(doseVolumeStartSchema.safeParse({...command,targetMassG:400}).success,false);
});
test('water-only cannot energize fertilizer and START always expires within 20 seconds',()=>{
 const command=start();assert.equal(doseVolumeStartSchema.safeParse({...command,mode:'water_only'}).success,false);
 assert.equal(doseVolumeStartSchema.safeParse({...command,mode:'water_only',targetStockVolumeL:0,nominalConcentrationGPerL:0,targetMassG:0}).success,true);
 assert.equal(doseVolumeStartSchema.safeParse({...command,expiresAt:new Date(Date.parse(command.issuedAt)+21000).toISOString()}).success,false);
});
test('browser requests cannot override actor, physical volumes, stock concentration or missing preparation confirmation',()=>{
 const request={mode:'fertigation',obligationId:'a'.repeat(64),requestId:start().planId};
 for(const extra of [{actor:'admin'},{targetMassG:900},{stockConcentrationGPerL:40},{waterVolumeL:9999}])
  assert.equal(doseVolumePlanRequestSchema.safeParse({...request,...extra}).success,false);
 assert.equal(doseVolumeApproveSchema.safeParse({planId:start().planId,approvalId:start().sessionId,preparedBatchConfirmed:false}).success,false);
});
