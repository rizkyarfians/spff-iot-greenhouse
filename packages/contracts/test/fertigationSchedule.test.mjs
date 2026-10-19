import test from 'node:test';
import assert from 'node:assert/strict';
import { fertigationRecipeMutationSchema } from '../dist/index.js';

const base={cropId:'sweet-potato',cropName:'Ubi Jalar',hstFrom:1,hstTo:35,targetWaterL:1,targetStockL:0,
  fertilizerName:null,stockConcentrationGPerL:null,minWaterTankPercent:20,minStockTankPercent:20,
  sourceReference:'Synthetic test fixture',plantingDate:'2026-10-18',applicationDate:null};
test('recurring schedule validates interval and preserves legacy defaults',()=>{
  const parse=input=>fertigationRecipeMutationSchema.safeParse(input);
  assert.equal(parse(base).data.applicationMode,'once');
  assert.equal(parse({...base,applicationMode:'interval',applicationIntervalDays:7}).success,true);
  for(const interval of [null,0,-1,1.5,1001]) assert.equal(parse({...base,applicationMode:'interval',applicationIntervalDays:interval}).success,false);
  assert.equal(parse({...base,applicationMode:'once',applicationIntervalDays:7}).success,false);
});

test('sensor trigger requires no calendar schedule and validates sample count',()=>{
  const sensor={...base,applicationMode:'sensor',applicationIntervalDays:null};
  assert.equal(fertigationRecipeMutationSchema.parse(sensor).triggerSampleCount,3);
  for(const count of [0,21,1.5]) assert.equal(fertigationRecipeMutationSchema.safeParse({...sensor,triggerSampleCount:count}).success,false);
  assert.equal(fertigationRecipeMutationSchema.safeParse({...sensor,applicationIntervalDays:1}).success,false);
});
