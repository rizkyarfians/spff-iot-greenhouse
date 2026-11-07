import test from 'node:test';
import assert from 'node:assert/strict';
import {findEcWaterBaseline,findPreInjectionEcReference} from '../dist/ecDoseEstimator.js';
const before=new Date('2026-11-07T12:34:22Z');
function row(seconds,water=false,fert=false,ec=150){
 const at=new Date(before.getTime()+seconds*1000);
 return {telemetry_id:String(100+seconds),recorded_at:at,status_at:at,status_online:true,
  liquid_ec_us_cm:ec,flow_water_lpm:water?100:0,flow_fert_lpm:fert?5:0,
  sensor_health:{liquid_ec_us_cm:{valid:true},flow_water_lpm:{valid:true},flow_fert_lpm:{valid:true}},
  raw_payload:{sensorHealth:{soil_2_moisture:{pollBootId:'boot-a'}}},
  status_payload:{pulseBootId:'boot-a',pumpReadbackValid:true,pumpWaterActualActive:water,pumpFertActualActive:fert}};
}
const client=rows=>({query:async()=>({rows})});
test('latest valid pre-ON sensor value can initialize a labelled estimate',async()=>{
 const baseline=await findPreInjectionEcReference(client([row(-10),row(-40,false,false,130)]),'s','d',before,'boot-a');
 assert.equal(baseline.ec,150);assert.equal(baseline.basis,'PRE_INJECTION_SENSOR');assert.equal(baseline.evidence.length,1);
});
test('a current mixing reading, invalid readback, wrong boot or moving water is not an idle EC reference',async()=>{
 const inactive=row(-10);inactive.sensor_health.liquid_ec_us_cm.valid=false;
 const unknown=row(-10);unknown.status_payload.pumpReadbackValid=false;
 const moving=row(-10);moving.flow_water_lpm=5;
 for(const sample of [row(-10,true,true),inactive,unknown,moving])
  assert.equal(await findPreInjectionEcReference(client([sample]),'s','d',before,'boot-a'),null);
 assert.equal(await findPreInjectionEcReference(client([row(-10)]),'s','d',before,'other-boot'),null);
});
test('one fresh flowing water-only sensor reading no longer waits for three telemetry periods',async()=>{
 const baseline=await findEcWaterBaseline(client([row(-10,true,false)]),'s','d',before,'boot-a');
 assert.equal(baseline.ec,150);assert.equal(baseline.basis,'WATER_ONLY_SENSOR');
 assert.equal(await findEcWaterBaseline(client([row(-130,true,false)]),'s','d',before),null);
});
test('stable water-only history remains preferred over an idle reference',async()=>{
 const baseline=await findEcWaterBaseline(client([row(-10,true,false),row(-40,true,false),row(-70,true,false)]),'s','d',before,'boot-a');
 assert.equal(baseline.basis,'WATER_ONLY_STABLE');assert.equal(baseline.evidence.length,3);
});
