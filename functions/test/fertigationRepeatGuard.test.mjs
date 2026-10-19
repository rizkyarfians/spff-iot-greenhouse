import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleBasedRepeatHoldReasons as hold } from '../lib/services/fertigationRepeatGuard.js';

const now=new Date('2026-10-19T08:00:00Z');
const finished=new Date('2026-10-19T07:30:00Z');
const yesterday=new Date('2026-10-18T07:30:00Z');
const recipe={recipeId:'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
  applicationMode:'sensor',triggerSampleCount:3,moistureTargetPercent:60,targetStockL:0};
const snapshot={recentSamples:[1,2,3].map(n=>({
  recordedAt:new Date(now.getTime()-n*10000),moisture:20,moistureValid:true,ec:null,ecValid:false,
}))};
const session=(status,when=finished)=>({
  recipeId:recipe.recipeId,status,startedAt:new Date(when.getTime()-120000),
  finishedAt:status==='running'||status==='started'?null:when,lastRecordedAt:when,
  targetStockL:0,completionProven:status==='completed',
});
test('active sessions across any program block a new run',()=>{
  for(const status of ['running','started']){
    assert.ok(hold(recipe,snapshot,{sessions:[{...session(status),recipeId:'other'}],recoveredAt:null},now).length);
  }
});
test('fault and aborted sessions block automatic retry',()=>{
  for(const status of ['fault','aborted'])assert.ok(hold(recipe,snapshot,{
    sessions:[session(status)],recoveredAt:null},now).some(x=>x.includes('pemeriksaan operator')));
});
test('sensor mode cannot retrigger without verified wet recovery after completion',()=>{
  const evidence={sessions:[session('completed')],recoveredAt:null};
  assert.ok(hold(recipe,snapshot,evidence,now).some(x=>x.includes('belum terbukti pulih')));
  evidence.recoveredAt=new Date('2026-10-19T07:00:00Z');
  assert.ok(hold(recipe,snapshot,evidence,now).some(x=>x.includes('belum terbukti pulih')));
  evidence.recoveredAt=new Date('2026-10-19T07:40:00Z');
  assert.deepEqual(hold(recipe,snapshot,evidence,now),[]);
});
test('recovery followed by stale dry readings is not a rearm',()=>{
  const stale={recentSamples:snapshot.recentSamples.map(x=>({...x,recordedAt:new Date('2026-10-19T07:35:00Z')}))};
  assert.ok(hold(recipe,stale,{sessions:[session('completed')],recoveredAt:new Date('2026-10-19T07:40:00Z')},now).length);
});
test('once and interval rules allow at most one application on Jakarta due date',()=>{
  for(const applicationMode of ['once','interval']){
    assert.ok(hold({...recipe,applicationMode},snapshot,{
      sessions:[session('completed')],recoveredAt:null},now).some(x=>x.includes('tanggal jadwal')));
    assert.deepEqual(hold({...recipe,applicationMode},snapshot,{
      sessions:[session('completed',yesterday)],recoveredAt:null},now),[]);
  }
});
test('fertilizer already completed today blocks another automatic dose even from another rule',()=>{
  assert.ok(hold({...recipe,targetStockL:1},snapshot,{
    sessions:[{...session('completed'),recipeId:'different-rule',targetStockL:1}],
    recoveredAt:null},now).some(x=>x.includes('Pupuk sudah diaplikasikan')));
});
test('unproven completed sessions hold even with recovery',()=>{
  assert.ok(hold(recipe,snapshot,{
    sessions:[{...session('completed'),completionProven:false}],
    recoveredAt:new Date('2026-10-19T07:40:00Z')},now).length);
});
