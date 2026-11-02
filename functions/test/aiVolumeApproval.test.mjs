import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  aiVolumeApprovalRequestSchema,
  aiVolumeApprovalSnapshotSchema,
} from '@spff/contracts';
import {
  planAiVolumeApproval,
  aiApprovalRequestFingerprint,
  isApprovalExpired,
} from '../lib/services/aiVolumeApprovalPlanning.js';

function source(now = new Date()) {
  const timestamp = now.toISOString();
  return {
    mode:'SHADOW_MODE',can_dispatch:false,status:'STALE',
    planning_source:'POSTGRES_READ_ONLY',planning_status:'CURRENT',
    planning_recorded_at:timestamp,
    sensors:{recorded_at:timestamp,control_moisture_source:'soil_2_moisture',device_mode:'automatic'},
    fuzzy_preview_blockers:[],
    fuzzy_preview:{
      basis:'SIMULATION_PROFILE',config_version:'simulation-1',
      input_key:'soil_2_moisture',moisture_pct:29,score:0.72,
      illustrative_water_l:381.63727278975847,model_max_irrigation_l:500,
      recorded_at:timestamp,
    },
    decision:{type:'HOLD',proposed_action:'FERTIGATE',hold_reasons:['manual_mode_blocks_automatic_start']},
  };
}
function requestFor(summary, approvalId=randomUUID()) {
  return {
    approvalId,deviceId:'esp32-s3-test-isolated',trialCapL:5,durationSec:30,
    confirmation:'APPROVE_SHADOW_TRIAL_DRAFT',
    expected:{
      sourceRecordedAt:summary.fuzzy_preview.recorded_at,
      sourceVolumeL:summary.fuzzy_preview.illustrative_water_l,
      targetWaterL:5,
      configVersion:summary.fuzzy_preview.config_version,
    },
  };
}

test('admin approval pins actual Fuzzy snapshot without creating command or dispatch grant',()=>{
  const now=new Date();
  const summary=source(now);
  const input=requestFor(summary);
  const parsed=aiVolumeApprovalRequestSchema.parse(input);
  const result=planAiVolumeApproval(summary,parsed,'admin-review',now);
  assert.equal(aiVolumeApprovalSnapshotSchema.safeParse(result).success,true);
  assert.equal(result.stage,'APPROVED_DRAFT_ONLY');
  assert.equal(result.canDispatch,false);
  assert.equal(result.commandCreated,false);
  assert.equal(result.candidate.source.illustrativeWaterL,381.63727278975847);
  assert.equal(result.candidate.conversion.targetWaterL,5);
  assert.equal(result.candidate.source.decisionStatus,'STALE');
  assert.equal(isApprovalExpired(result,now),false);
  assert.equal(isApprovalExpired(result,new Date(now.getTime()+125000)),true);
  assert.equal(aiVolumeApprovalSnapshotSchema.safeParse({...result,canDispatch:true}).success,false);
});

test('cannot approve a changed, stale, or missing SHADOW Fuzzy snapshot',()=>{
  const now=new Date();const summary=source(now);const input=requestFor(summary);
  for(const patch of [
    {expected:{...input.expected,sourceVolumeL:380}},
    {expected:{...input.expected,targetWaterL:6}},
    {expected:{...input.expected,configVersion:'fake'}},
    {expected:{...input.expected,sourceRecordedAt:'2026-01-01T00:00:00Z'}},
  ]) assert.throws(()=>planAiVolumeApproval(summary,{...input,...patch},'admin-review',now));
  assert.throws(()=>planAiVolumeApproval({...summary,planning_status:'STALE'},input,'admin-review',now));
  assert.throws(()=>planAiVolumeApproval({...summary,fuzzy_preview_blockers:['sensor_raw_poll_not_verified']},input,'admin-review',now));
  assert.throws(()=>planAiVolumeApproval(summary,input,'',now));
  assert.throws(()=>planAiVolumeApproval({...summary,sensors:{...summary.sensors,device_mode:'manual'}},input,'admin-review',now));
});

test('fingerprint binds actor, exact AI values and confirmation',()=>{
  const summary=source();const input=requestFor(summary);
  const a=aiApprovalRequestFingerprint(input,'admin-a');
  assert.equal(a,aiApprovalRequestFingerprint(input,'admin-a'));
  assert.notEqual(a,aiApprovalRequestFingerprint(input,'admin-b'));
  assert.notEqual(a,aiApprovalRequestFingerprint({...input,trialCapL:6},'admin-a'));
  assert.throws(()=>aiApprovalRequestFingerprint({...input,confirmation:'RUN_CALIBRATION_TRIAL'},'admin-a'));
});

test('isolated Postgres persists approval exactly once and queue remains blocked', {
  skip:process.env.SPFF_TEST_ISOLATED_TRANSPORT!=='true',
  timeout:15000,
}, async()=>{
  assert.match(process.env.SPFF_TEST_DB_DIRECTORY??'',/^\/(?:var\/)?tmp\//);
  assert.equal(process.env.DATABASE_URL,'postgresql://invalid:invalid@127.0.0.1:1/never_used');
  assert.ok(process.env.PGPORT);
  const {default:pgModule}=await import('pg');
  const pg=new pgModule.Pool({
    host:process.env.PGHOST,
    port:Number(process.env.PGPORT),database:'postgres',
    user:process.env.PGUSER,max:2,
  });
  const {approveAiVolumeTrial,getAiVolumeApproval,queueApprovedAiVolumeTrial}
    =await import('../lib/services/aiVolumeApprovalService.js');
  const siteId='ai-approval-isolated-test';
  const now=new Date();const summary=source(now);
  const input=requestFor(summary);const actor='admin-isolated-test';
  try {
    await pg.query('INSERT INTO spff.sites(site_id,name) VALUES($1,$2)',[siteId,'AI test only']);
    await pg.query('INSERT INTO spff.devices(site_id,device_id,display_name) VALUES($1,$2,$3)',
      [siteId,input.deviceId,'SIMULATOR ONLY']);
    const a=await approveAiVolumeTrial(input,actor,summary,pg,siteId);
    assert.equal(a.status,'approved');assert.equal(a.idempotent,false);
    assert.equal(a.approval.canDispatch,false);assert.equal(a.commandId,null);
    const b=await approveAiVolumeTrial(input,actor,summary,pg,siteId);
    assert.equal(b.idempotent,true);
    assert.deepEqual(b.approval,a.approval);
    await assert.rejects(()=>approveAiVolumeTrial({...input,trialCapL:7},actor,summary,pg,siteId));
    const got=await getAiVolumeApproval(input.approvalId,pg,siteId);
    assert.equal(got?.approval.candidate.conversion.targetWaterL,5);
    const rows=await pg.query('SELECT COUNT(*)::int AS n FROM spff.ai_volume_trial_approvals WHERE site_id=$1',
      [siteId]);
    assert.equal(rows.rows[0].n,1);
    await assert.rejects(()=>queueApprovedAiVolumeTrial(input.approvalId,
      {confirmation:'QUEUE_APPROVED_WATER_TRIAL'},actor,summary,pg,siteId),
    /nonaktif/);
    const count=await pg.query('SELECT COUNT(*)::int AS n FROM spff.control_commands WHERE site_id=$1',[siteId]);
    assert.equal(count.rows[0].n,0);
    const persisted=await pg.query('SELECT status FROM spff.ai_volume_trial_approvals WHERE site_id=$1',[siteId]);
    assert.equal(persisted.rows[0].status,'approved');
  }finally{await pg.end();}
});
