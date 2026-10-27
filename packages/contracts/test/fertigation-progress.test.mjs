import test from 'node:test';
import assert from 'node:assert/strict';
import {fertigationProgressMetric as metric} from '../dist/index.js';
test('500 of 1200 EC gives 41.67 percent and a concentration gap of 700',()=>{
 const p=metric('soil','EC tanah','µS/cm',500,1200);assert.ok(Math.abs(p.percent-41.6666667)<0.0001);assert.equal(p.remaining,700);
 assert.equal(p.value,500);assert.equal(p.target,1200);
});
test('zero is valid; absent/invalid targets and readings never invent progress',()=>{
 assert.equal(metric('soil','EC','µS/cm',0,1200).percent,0);
 for(const n of [null,NaN,Infinity,-1]){const p=metric('soil','EC','µS/cm',n,1200);assert.equal(p.value,null);assert.equal(p.percent,null);assert.equal(p.remaining,null);}
 for(const n of [null,0,NaN])assert.equal(metric('soil','EC','µS/cm',500,n).percent,null);
});
test('over-target bars cap visually without losing the actual value; tank level uses capacity',()=>{
 const p=metric('soil','EC','µS/cm',1300,1200);assert.equal(p.percent,100);assert.equal(p.value,1300);assert.equal(p.remaining,0);
 const tank=metric('water','Isi tandon','%',40,100,20);assert.equal(tank.percent,40);assert.equal(tank.minimum,20);
});
