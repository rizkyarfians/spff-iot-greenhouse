import test from 'node:test';
import assert from 'node:assert/strict';
import { fertilizationPhases } from '@spff/contracts';
import { calculateDeliveredFertilizerGrams, fertilizerProgress } from '../dist/fertilizerDelivery.js';
import { readProductionFuzzy } from '../dist/automaticFuzzyWater.js';

test('fertilizer formula hook has no fabricated default and rejects unknown completion',()=>{
  assert.equal(calculateDeliveredFertilizerGrams({targetG:400}),null);
  for(const value of [null,NaN,Infinity,-1]) assert.equal(fertilizerProgress(400,value).fulfilled,false);
  assert.deepEqual(fertilizerProgress(400,125),{remainingG:275,fulfilled:false});
  assert.deepEqual(fertilizerProgress(400,450),{remainingG:0,fulfilled:true});
});

test('phase target uses grams and the Guide phase title, and ignores other products or methods',()=>{
  const req={product:'Phonska plus',amount:0.4,unit:'kg'};
  const plan={activities:[{id:'phase-2',title:'Pemupukan ke-2',hst:20,method:'Tabur',requirements:[req]},
    {id:'spray',title:'Semprot',hst:10,method:'Semprot',requirements:[req]},
    {id:'other',title:'Lain',hst:10,method:'Tabur',requirements:[{...req,product:'Ultradap'}]}]};
  const phases=fertilizationPhases(plan);
  assert.equal(phases.length,1);assert.equal(phases[0].targetG,400);assert.equal(phases[0].phaseNumber,2);
  plan.activities[0].requirements[0]={...req,unit:'L'};
  assert.equal(fertilizationPhases(plan)[0].targetG,null,'volume cannot masquerade as fertilizer grams');
});

test('automatic water consumes only a current production Fuzzy result',async()=>{
  const fetch=globalThis.fetch;
  let data={planning_status:'CURRENT',production_fuzzy:{status:'READY',basis:'TANK_INVENTORY_FUZZY',input_key:'soil_2_moisture',
    irrigation_needed:true,target_water_l:100,recorded_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()}};
  globalThis.fetch=async()=>({ok:true,json:async()=>data});
  try{
    assert.equal((await readProductionFuzzy()).targetL,100);
    data.production_fuzzy.basis='SIMULATION_PROFILE';assert.equal(await readProductionFuzzy(),null);
    data.production_fuzzy.basis='TANK_INVENTORY_FUZZY';data.planning_status='STALE';assert.equal(await readProductionFuzzy(),null);
    data.planning_status='CURRENT';data.production_fuzzy=null;assert.equal(await readProductionFuzzy(),null);
  }finally{globalThis.fetch=fetch;}
});
