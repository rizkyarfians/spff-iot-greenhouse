import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateEcDoseInterval} from '../dist/fertilizerDelivery.js';
import {ecDoseProfileInputSchema} from '@spff/contracts';

const point=(seconds,total=seconds*200/60)=>({id:String(seconds),at:new Date(1700000000000+seconds*1000).toISOString(),
  ec:3000,totalL:total,flowLpm:200,stockLpm:7,waterOn:true,fertOn:true,boot:'boot-a',valid:true,reason:'valid'});

test('document example integrates 1312.5 g over 15 minutes without adding fertilizer flow twice',()=>{
  let grams=0;
  for(let i=1;i<=30;i++)grams+=estimateEcDoseInterval(point((i-1)*30),point(i*30),200,6400).massG;
  assert.equal(grams,1312.5);assert.equal(grams/2000,0.65625);
  assert.equal(estimateEcDoseInterval(point(0),point(30),200,6400).volumeL,100);
});

test('EC below water baseline gives zero; flow fallback keeps minutes and liters consistent',()=>{
  assert.equal(estimateEcDoseInterval(point(0),{...point(30),ec:100},200,6400).massG,0);
  const interval=estimateEcDoseInterval({...point(0),totalL:null},{...point(30),totalL:null},200,6400);
  assert.equal(interval.massG,43.75);assert.equal(interval.reason,'flow_integrated_volume');
  const totalizerProof=estimateEcDoseInterval({...point(0),stockTotalL:5},{...point(30),stockTotalL:6,stockLpm:0},200,6400);
  assert.equal(totalizerProof.massG,43.75,'a valid rising fertilizer totalizer confirms injection between zero instantaneous readings');
});

test('invalid gaps, reboot, counter rollback and pump transitions do not fabricate mass',()=>{
  for(const current of [point(121),{...point(30),boot:'boot-b'},point(30,-1),{...point(30),valid:false},
    {...point(30),stockLpm:0}]){
    const result=estimateEcDoseInterval(point(0),current,200,6400);
    assert.equal(result.status,'invalid');assert.equal(result.massG,null);
  }
  assert.equal(estimateEcDoseInterval(point(0),point(0),200,6400).reason,'duplicate_sample');
  assert.equal(estimateEcDoseInterval({...point(0),fertOn:false},point(30),200,6400).status,'excluded');
});

test('website calibration requires a finite K and a reference for verified use',()=>{
  const profile={product:'Phonska',coefficient:6400,expectedRevision:0};
  assert.equal(ecDoseProfileInputSchema.parse(profile).validated,false);
  assert.equal(ecDoseProfileInputSchema.safeParse({...profile,validated:true}).success,false);
  assert.equal(ecDoseProfileInputSchema.safeParse({...profile,coefficient:0}).success,false);
  assert.equal(ecDoseProfileInputSchema.safeParse({...profile,validated:true,calibrationReference:'Uji lapangan 01'}).success,true);
});
