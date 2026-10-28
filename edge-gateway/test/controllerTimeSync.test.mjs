import test from 'node:test'
import assert from 'node:assert/strict'
import {ControllerTimeSync,chronyClockSynchronized} from '../dist/controllerTimeSync.js'
const epoch=Date.parse('2026-10-28T10:00:00Z')
const tracking=`Stratum         : 3\nRef time (UTC)  : Wed Oct 28 09:59:00 2026\nSystem time     : 0.000123 seconds slow of NTP time\nLeap status     : Normal\n`
const ack={kind:'time_sync_ack',schemaVersion:1,siteId:'greenhouse-01',deviceId:'esp32-s3-01',status:'applied'}
test('Chrony gate rejects unsynchronized, stale, malformed and excessive-offset clocks',()=>{
 assert.equal(chronyClockSynchronized(tracking,epoch),true)
 for(const text of ['',tracking.replace('Normal','Not synchronised'),tracking.replace(': 3',': 0'),tracking.replace('0.000123','8.5'),tracking.replace('Oct 28','Oct 25')])assert.equal(chronyClockSynchronized(text,epoch),false)
})
test('time sync uses UTC on the existing writer, waits for matching ACK and refreshes hourly/reconnect',async()=>{
 let now=epoch;const sent=[]
 const sync=new ControllerTimeSync({siteId:ack.siteId,deviceId:ack.deviceId,isAvailable:()=>true,send:async m=>sent.push(m),clockSynchronized:async()=>true,now:()=>now})
 await sync.sync('test');assert.equal(sent.length,1);assert.equal(sent[0].utcEpoch,epoch/1000)
 now+=30000;await sync.sync('test');assert.equal(sent.length,1)
 sync.receive({...ack,deviceId:'other'});now+=30000;await sync.sync('test');assert.equal(sent.length,2)
 sync.receive(ack);now+=60000;await sync.sync('test');assert.equal(sent.length,2)
 now+=3600000;await sync.sync('test');assert.equal(sent.length,3)
 sync.receive(ack);sync.reconnected();await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,4)
 sync.stop();now+=3600000;await sync.sync('test');assert.equal(sent.length,4)
 assert.equal(sync.receive({kind:'adaptive_fert_ack'}),false)
})
test('unsynced host is rate limited and shutdown/reconnect cannot forward a stale in-flight check',async()=>{
 let now=epoch,calls=0;const sent=[]
 const sync=new ControllerTimeSync({siteId:ack.siteId,deviceId:ack.deviceId,isAvailable:()=>true,send:async m=>sent.push(m),clockSynchronized:async()=>{calls++;return false},now:()=>now})
 await sync.sync('test');now+=15000;await sync.sync('test');assert.equal(calls,1);assert.equal(sent.length,0)
 now+=60000;await sync.sync('test');assert.equal(calls,2)
 let release;const pending=new Promise(resolve=>{release=resolve})
 const second=new ControllerTimeSync({siteId:ack.siteId,deviceId:ack.deviceId,isAvailable:()=>true,send:async m=>sent.push(m),clockSynchronized:()=>pending,now:()=>now})
 const request=second.sync('test');second.stop();release(true);await request;assert.equal(sent.length,0)
 sync.stop()
})
