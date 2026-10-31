import test from 'node:test'
import assert from 'node:assert/strict'
import {adaptiveStartCommandSchema,adaptiveStartPlanSchema,adaptiveDispatchSchema,adaptiveSessionInputSchema,adaptiveAckSchema,adaptiveTelemetrySchema} from '../dist/index.js'
const command={kind:'adaptive_fert_command',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',commandId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',commandType:'start',targetEcUs:2500,ecToleranceUs:100,maxDurationSec:600,targetWaterVolumeL:100,targetFertVolumeL:5,nominalConcentrationGPerL:10,plantCount:2000,flushDurationSec:30,bootId:'boot-1503',issuedAt:'2026-10-31T12:00:00Z',expiresAt:'2026-10-31T12:00:15Z'}
test('adaptive starts require every supported v1.5 configuration field and enforce exact firmware bounds',()=>{
 assert.equal(adaptiveStartCommandSchema.safeParse(command).success,true)
 for(const key of ['targetEcUs','ecToleranceUs','maxDurationSec','targetWaterVolumeL','targetFertVolumeL','nominalConcentrationGPerL','plantCount','flushDurationSec','bootId','issuedAt','expiresAt']){const missing={...command};delete missing[key];assert.equal(adaptiveStartCommandSchema.safeParse(missing).success,false,key)}
 for(const patch of [{targetEcUs:8000},{targetEcUs:100},{targetFertVolumeL:0.5},{targetWaterVolumeL:9},{flushDurationSec:0},{targetEcUs:NaN},{sessionId:''},{unknown:1}])assert.equal(adaptiveStartCommandSchema.safeParse({...command,...patch}).success,false)
})
test('preview is not dispatchable and firmware TTL cannot be missing, reversed or extended by the envelope',()=>{
 const {bootId,issuedAt,expiresAt,...preview}=command
 assert.equal(adaptiveStartPlanSchema.safeParse(preview).success,true)
 assert.equal(adaptiveStartCommandSchema.safeParse(preview).success,false)
 for(const patch of [{bootId:''},{expiresAt:issuedAt},{expiresAt:'2026-10-31T12:05:01Z'}])assert.equal(adaptiveStartCommandSchema.safeParse({...command,...patch}).success,false)
 const envelope={kind:'adaptive_fert_dispatch',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,command,expiresAt}
 assert.equal(adaptiveDispatchSchema.safeParse(envelope).success,true)
 assert.equal(adaptiveDispatchSchema.safeParse({...envelope,expiresAt:'2026-10-31T12:00:16Z'}).success,false)
})
test('session input cannot accept a manual EC target and distinguishes stock concentration from final solution',()=>{
 const input={programId:command.sessionId,expectedProgramRevision:1,activityId:'row-10',requestId:command.commandId,waterMeterPosition:'before_injector',waterVolumeL:100,stockConcentrationGPerL:100,ecToleranceUs:100,maxDurationSec:600,flushDurationSec:30,hydraulicsReference:'Test commissioning reference'}
 assert.equal(adaptiveSessionInputSchema.safeParse(input).success,true)
 assert.equal(adaptiveSessionInputSchema.safeParse({...input,targetEcUs:2500}).success,false)
 assert.equal(adaptiveSessionInputSchema.safeParse({...input,waterMeterPosition:undefined}).success,false)
})
test('firmware rejection with empty IDs remains diagnostic, while numeric telemetry rejects invalid counters',()=>{
 assert.equal(adaptiveAckSchema.safeParse({kind:'adaptive_fert_ack',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,sessionId:'',commandId:'',state:'IDLE',status:'rejected',acknowledgedAt:new Date().toISOString(),reason:'session_already_active'}).success,true)
 const telemetry={kind:'adaptive_fert_telemetry',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,sessionId:command.sessionId,timestamp:new Date().toISOString(),state:'EC_CONTROL',filteredEc:2500,rawEc:2500,waterFlowLpm:10,fertFlowLpm:1,waterVolumeL:10,fertVolumeL:1,fertMassGrams:10,volumePerPlantMl:5,waterPump:true,fertPump:true,faultReason:'none',ecTargetUnreachable:false}
 assert.equal(adaptiveTelemetrySchema.safeParse(telemetry).success,true)
 assert.equal(adaptiveTelemetrySchema.safeParse({...telemetry,fertVolumeL:-1}).success,false)
 assert.equal(adaptiveTelemetrySchema.safeParse({...telemetry,rawEc:NaN}).success,false)
 const frame={...telemetry,bootId:'boot-1503',ecValid:true,flowValid:true,ecAgeMs:100,flowAgeMs:200,waterPumpKnown:true,fertPumpKnown:true,volumeEstimated:false,targetEcUs:2500,controlAlgorithm:'ec_hysteresis_ema',firmwareVersion:'1.5.03-SHT20-TELEMETRY-SYNC'}
 assert.deepEqual(adaptiveTelemetrySchema.parse(frame),frame)
 assert.equal(adaptiveTelemetrySchema.safeParse({...frame,state:'IDLE',sessionId:''}).success,true)
 assert.equal(adaptiveTelemetrySchema.safeParse({...frame,sessionId:''}).success,false)
 assert.equal(adaptiveTelemetrySchema.safeParse({...frame,ecAgeMs:-1}).success,false)
})
