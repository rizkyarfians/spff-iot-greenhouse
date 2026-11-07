import test from 'node:test';
import assert from 'node:assert/strict';
import {isScheduleSyncMessage} from '@spff/contracts';
import {nativeHstSchedules,hstScheduleId,retryableModeRejection} from '../dist/nativeHstSchedule.js';

const id='11111111-1111-4111-8111-111111111111';
const row={site_id:'greenhouse-01',device_id:'esp32-s3-01',start_id:id,run_date:'2026-11-07'};
test('HST registers both actual schedule IDs with the existing native server contract',()=>{
 const schedules=nativeHstSchedules([row],'server',row.site_id,row.device_id);
 assert.equal(schedules.length,2);
 for(const schedule of schedules){
  const requestedBy=`schedule:${schedule.scheduleId}:on`;
  assert.ok(requestedBy.startsWith('schedule:')&&requestedBy.endsWith(':on'));
  assert.equal(requestedBy.slice(9,-3),hstScheduleId(id,schedule.targetId));
  assert.ok(!schedule.scheduleId.includes(':'));
 }
 assert.equal(isScheduleSyncMessage({kind:'schedule_sync',schemaVersion:1,siteId:row.site_id,deviceId:row.device_id,
  revision:2,generatedAt:'2026-11-07T12:00:00Z',executionAuthority:'server',schedules}),true);
});
test('HST never inserts independent timers under device authority or into another device',()=>{
 assert.deepEqual(nativeHstSchedules([row],'device',row.site_id,row.device_id),[]);
 assert.deepEqual(nativeHstSchedules([row],'server',row.site_id,'other'),[]);
});
test('retry is limited to both automatic-mode rejections and later OFF evidence, once',()=>{
 const expired=new Date('2026-11-07T12:00:00Z'),fresh=new Date('2026-11-07T12:01:00Z');
 const start={status:'failed',water_status:'rejected',fert_status:'rejected',water_reason:'automatic_mode',
  fert_reason:'automatic_mode',water_expires:expired,fert_expires:expired,retried:false};
 assert.equal(retryableModeRejection(start,fresh),true);
 for(const patch of [{retried:true},{status:'started'},{water_status:'timed_out'},
  {fert_reason:'water_tank_interlock'},{water_expires:new Date('2026-11-07T12:02:00Z')}])
  assert.equal(retryableModeRejection({...start,...patch},fresh),false);
});
