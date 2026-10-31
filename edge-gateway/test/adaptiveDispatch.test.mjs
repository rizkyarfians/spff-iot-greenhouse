import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {AdaptiveDispatchGuard,adaptiveEnvelope} from '../dist/adaptiveDispatch.js'
import {DurableOutbox} from '../dist/outbox.js'
const command={kind:'adaptive_fert_command',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',commandId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',commandType:'start',targetEcUs:2500,ecToleranceUs:100,maxDurationSec:600,targetWaterVolumeL:100,targetFertVolumeL:5,nominalConcentrationGPerL:10,plantCount:2000,flushDurationSec:30,bootId:'boot-1503',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+15000).toISOString()}
const envelope=()=>({kind:'adaptive_fert_dispatch',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,command,expiresAt:command.expiresAt})
test('adaptive dispatch persists dedup across guard restarts, sends exact firmware shape and blocks conflicts/expiry',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'spff-adaptive-')),sent=[],events=[]
 try{
  let guard=new AdaptiveDispatchGuard(directory,async p=>sent.push(p),async e=>events.push(e));const message=envelope()
  await guard.forward(message);assert.deepEqual(sent,[command]);assert.equal(events[0].payload.status,'forwarded')
  guard=new AdaptiveDispatchGuard(directory,async p=>sent.push(p),async e=>events.push(e));await guard.forward(message);assert.equal(sent.length,1);assert.equal(events.at(-1).payload.status,'unknown')
  await assert.rejects(guard.forward({...message,command:{...command,targetEcUs:2600}}),/conflict/)
  await guard.forward({...message,expiresAt:new Date(Date.now()-1000).toISOString()});assert.equal(sent.length,1);assert.equal(events.at(-1).payload.status,'expired')
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('future-issued starts never reach serial and 1.5.03 idle telemetry is kept in the outbox envelope',async()=>{
 const sent=[],events=[],directory=await mkdtemp(path.join(tmpdir(),'spff-adaptive-'))
 try{
  const guard=new AdaptiveDispatchGuard(directory,async p=>sent.push(p),async e=>events.push(e))
  const issuedAt=new Date(Date.now()+10000).toISOString(),expiresAt=new Date(Date.now()+20000).toISOString()
  await guard.forward({...envelope(),command:{...command,issuedAt,expiresAt},expiresAt})
  assert.equal(sent.length,0);assert.equal(events[0].payload.reason,'gateway_command_not_yet_valid')
  const raw={kind:'adaptive_fert_telemetry',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,sessionId:'',timestamp:new Date().toISOString(),state:'IDLE',filteredEc:0,rawEc:2500,waterFlowLpm:0,fertFlowLpm:0,waterVolumeL:0,fertVolumeL:0,fertMassGrams:0,volumePerPlantMl:0,waterPump:false,fertPump:false,faultReason:'none',ecTargetUnreachable:false,ecValid:true,flowValid:true,ecAgeMs:100,flowAgeMs:100,waterPumpKnown:true,fertPumpKnown:true,volumeEstimated:false,targetEcUs:2500,bootId:'boot-1503',controlAlgorithm:'ec_hysteresis_ema',firmwareVersion:'1.5.03-SHT20-TELEMETRY-SYNC'}
  assert.equal(adaptiveEnvelope(raw).payload.bootId,'boot-1503')
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('serial uncertainty never causes an automatic retry, and adaptive outbox waits for database acknowledgement',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'spff-adaptive-')),events=[];let attempts=0
 try{
  const guard=new AdaptiveDispatchGuard(path.join(directory,'ledger'),async()=>{attempts++;throw Error('serial disconnected')},async e=>events.push(e)),message=envelope()
  await assert.rejects(guard.forward(message),/serial disconnected/);await guard.forward(message);assert.equal(attempts,1)
  const outbox=new DurableOutbox(directory,100);await outbox.start();const event=events[0];await outbox.enqueue({kind:'adaptive_event',payload:event})
  let published=0;await outbox.flush(async()=>{published++});await outbox.flush(async()=>{published++});assert.equal(published,2)
  assert.equal(await outbox.acknowledgeAdaptive(event.messageId),true);await outbox.flush(async()=>{published++});assert.equal(published,2)
  assert.equal(adaptiveEnvelope(event.payload).messageId,event.messageId)
 }finally{await rm(directory,{recursive:true,force:true})}
})
