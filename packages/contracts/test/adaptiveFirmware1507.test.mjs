import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveFirmware1507StartSchema,adaptiveStartCommandSchema,adaptiveDispatchSchema,adaptiveEventPayloadSchema} from '../dist/index.js';

const issuedAt = '2026-11-04T08:25:00.000Z';
const expiresAt = '2026-11-04T08:25:15.000Z';
const start={kind:'adaptive_fert_command',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',
 sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',commandId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 commandType:'start',targetEcUs:2500,ecToleranceUs:100,maxDurationSec:600,targetWaterVolumeL:100,
 targetFertVolumeL:5,nominalConcentrationGPerL:10,plantCount:2000,flushDurationSec:30,
 bootId:'a1b2c3d4e5f60708',issuedAt,expiresAt};
const dispatch=command=>({kind:'adaptive_fert_dispatch',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,command,expiresAt});
test('1.5.07 START needs fresh boot identity and bounded issued/expiry timestamps',()=>{
 assert.equal(adaptiveFirmware1507StartSchema.safeParse(start).success,true);
 assert.equal(adaptiveDispatchSchema.safeParse(dispatch(start)).success,true);
 const {bootId,issuedAt,expiresAt,...preview}=start;
 assert.equal(adaptiveStartCommandSchema.safeParse(preview).success,true);
 for(const field of ['bootId','issuedAt','expiresAt']){
  const broken={...start};delete broken[field];
  assert.equal(adaptiveDispatchSchema.safeParse(dispatch(broken)).success,false,field);
 }
 assert.equal(adaptiveDispatchSchema.safeParse(dispatch({...start,bootId:'ffffffffffffffff'})).success,true);
 assert.equal(adaptiveDispatchSchema.safeParse({...dispatch(start),expiresAt:'2026-11-04T08:25:16.000Z'}).success,false);
 assert.equal(adaptiveFirmware1507StartSchema.safeParse({...start,expiresAt:'2026-11-04T08:31:00.000Z'}).success,false);
 assert.equal(adaptiveFirmware1507StartSchema.safeParse({...start,bootId:'no-boot-id'}).success,false);
});
test('actual 1.5.07 adaptive telemetry diagnostics survive strict schema validation',()=>{
 const telemetry={kind:'adaptive_fert_telemetry',schemaVersion:1,siteId:start.siteId,deviceId:start.deviceId,
 sessionId:start.sessionId,timestamp:issuedAt,state:'EC_CONTROL',filteredEc:2100,rawEc:2105,
 waterFlowLpm:50,fertFlowLpm:1,waterVolumeL:10,fertVolumeL:1,fertMassGrams:10,
 volumePerPlantMl:5,waterPump:true,fertPump:true,faultReason:'none',ecTargetUnreachable:false,
 ecValid:true,flowValid:true,ecAgeMs:100,flowAgeMs:150,waterPumpKnown:true,fertPumpKnown:true,
 volumeEstimated:false,targetEcUs:2500,bootId:start.bootId,controlAlgorithm:'ec_hysteresis_ema',
 firmwareVersion:'1.5.06-TIMED-WATER-AI-GUARD'};
 assert.equal(adaptiveEventPayloadSchema.safeParse(telemetry).success,true);
 assert.equal(adaptiveEventPayloadSchema.safeParse({...telemetry,unknown:'field'}).success,false);
});
