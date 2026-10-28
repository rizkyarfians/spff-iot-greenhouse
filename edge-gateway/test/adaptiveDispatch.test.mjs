import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {AdaptiveDispatchGuard,adaptiveEnvelope} from '../dist/adaptiveDispatch.js'
import {DurableOutbox} from '../dist/outbox.js'
const command={kind:'adaptive_fert_command',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',commandId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',commandType:'start',targetEcUs:2500,ecToleranceUs:100,maxDurationSec:600,targetWaterVolumeL:100,targetFertVolumeL:5,nominalConcentrationGPerL:10,plantCount:2000,flushDurationSec:30}
const envelope=()=>({kind:'adaptive_fert_dispatch',schemaVersion:1,siteId:command.siteId,deviceId:command.deviceId,command,expiresAt:new Date(Date.now()+15000).toISOString()})
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
