import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationDue, calculateHst, jakartaDay } from '../lib/services/fertigationSchedule.js';
import { evaluateAutomaticRuleBased } from '../lib/services/automaticRuleBased.js';

const recipe={plantingDate:'2026-10-18',hstFrom:1,hstTo:15,applicationMode:'interval',applicationIntervalDays:7,applicationDate:null};
test('one setup repeats at HST 1, 8, 15 and stops outside crop window',()=>{
  for(const date of ['2026-10-19','2026-10-26','2026-11-02']) assert.equal(applicationDue(recipe,date),true);
  for(const date of ['2026-10-18','2026-10-20','2026-11-09']) assert.equal(applicationDue(recipe,date),false);
  assert.equal(applicationDue({...recipe,applicationIntervalDays:0},'2026-10-19'),false);
  assert.equal(applicationDue({...recipe,plantingDate:null},'2026-10-19'),false);
});
test('daily recurrence requires no changing dates and follows Jakarta midnight',()=>{
  const daily={...recipe,applicationIntervalDays:1};
  const before=jakartaDay(new Date('2026-10-19T16:59:59Z'));
  const after=jakartaDay(new Date('2026-10-19T17:00:00Z'));
  assert.equal(before,'2026-10-19'); assert.equal(after,'2026-10-20');
  assert.equal(applicationDue(daily,before),true); assert.equal(applicationDue(daily,after),true);
  assert.equal(calculateHst(recipe.plantingDate,after),2);
});
test('historical once-only programs never silently become recurring',()=>{
  const once={...recipe,applicationMode:'once',applicationIntervalDays:null,applicationDate:'2026-10-19'};
  assert.equal(applicationDue(once,'2026-10-19'),true);
  assert.equal(applicationDue(once,'2026-10-20'),false);
});
test('overlapping recurring rules still hold instead of choosing arbitrarily',()=>{
  const approved={...recipe,approvalStatus:'approved',approvalReference:'TEST ONLY',cropId:'sweet-potato',zoneId:'soil-1'};
  const result=evaluateAutomaticRuleBased([approved,approved],'esp32-s3-01',{activeCropId:'sweet-potato'},new Date('2026-10-19T10:00:00Z'));
  assert.equal(result.eligibleCount,2); assert.equal(result.status,'hold'); assert.equal(result.canDispatch,false);
});
