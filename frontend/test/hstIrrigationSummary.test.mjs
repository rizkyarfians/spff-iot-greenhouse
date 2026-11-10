import test from 'node:test'
import assert from 'node:assert/strict'
import {fuzzyIrrigationEstimate,hstIrrigationDisplay,recentTankReadings,tankDisplayEstimate} from '../src/hstIrrigationSummary.ts'
const now=Date.parse('2026-11-04T15:52:15Z')
const current={
 planning_status:'CURRENT',planning_recorded_at:new Date(now).toISOString(),
 water_carryover:{status:'NO_PLAN',remaining_for_reassessment_l:null},
 irrigation_schedule_preview:{status:'GEOMETRY_ONLY',tomorrow_at_least_l:125,fuzzy_demand_l:600},
 fuzzy_preview:{illustrative_water_l:600,recorded_at:new Date(now).toISOString()},
}
test('NO_PLAN displays the existing Python capacity estimate without creating a plan',()=>{
 const before=structuredClone(current)
 const result=hstIrrigationDisplay(current,now)
 assert.equal(result.kind,'capacity_preview')
 assert.equal(result.valueL,125)
 assert.match(result.label,/estimasi kapasitas/)
 assert.match(result.note,/bukan realisasi/)
 assert.deepEqual(current,before)
})
test('recorded remaining volume takes priority and preserves a real zero',()=>{
 const source={...current,water_carryover:{status:'COMPLETE_REPORTED',remaining_for_reassessment_l:0}}
 const result=hstIrrigationDisplay(source,now)
 assert.equal(result.kind,'recorded')
 assert.equal(result.valueL,0)
 assert.equal(result.label,'Sisa kebutuhan penyiraman')
})
test('when tank geometry is unavailable show current Fuzzy demand under a demand label',()=>{
 const result=hstIrrigationDisplay({...current,irrigation_schedule_preview:{status:'HEIGHT_UNVERIFIED',tomorrow_at_least_l:null,fuzzy_demand_l:600}},now)
 assert.equal(result.kind,'demand_preview')
 assert.equal(result.valueL,600)
 assert.match(result.label,/Kebutuhan air/)
 assert.ok(!result.label.includes('Sisa'))
})
test('zero mathematical capacity deficit stays zero without claiming a delivered dose',()=>{
 const result=hstIrrigationDisplay({...current,irrigation_schedule_preview:{...current.irrigation_schedule_preview,tomorrow_at_least_l:0}},now)
 assert.equal(result.valueL,0)
 assert.equal(result.kind,'capacity_preview')
 assert.match(result.note,/bukan realisasi/)
})
test('missing, invalid, stale and future data do not turn into a fabricated zero',()=>{
 for(const source of [
  null,
  {...current,planning_status:'STALE'},
  {...current,planning_recorded_at:'2026-11-04T15:40:00Z'},
  {...current,planning_recorded_at:'2026-11-04T16:00:00Z'},
  {...current,irrigation_schedule_preview:undefined,fuzzy_preview:null},
  {...current,irrigation_schedule_preview:undefined,fuzzy_preview:{illustrative_water_l:600,recorded_at:'2026-11-04T15:40:00Z'}},
  {...current,irrigation_schedule_preview:{status:'GEOMETRY_ONLY',tomorrow_at_least_l:NaN},fuzzy_preview:{illustrative_water_l:-1,recorded_at:new Date(now).toISOString()}},
 ]){
  const result=hstIrrigationDisplay(source,now)
  assert.equal(result.kind,'unavailable')
  assert.equal(result.valueL,null)
 }
})

test('operational Guide calculation is distinguished from a simulator',()=>{
 const source={...current,irrigation_schedule_preview:undefined,
  fuzzy_preview:{illustrative_water_l:844.44,recorded_at:new Date(now).toISOString(),basis:'OPERATIONAL_PROFILE'}}
 const result=hstIrrigationDisplay(source,now)
 assert.equal(result.valueL,844.44)
 assert.match(result.label,/profil Panduan/)
 assert.ok(!result.note.includes('Profil simulasi'))
 const simulated=hstIrrigationDisplay({...source,fuzzy_preview:{...source.fuzzy_preview,basis:'SIMULATION_PROFILE'}},now)
 assert.match(simulated.label,/simulasi Fuzzy/)
})

test('Fuzzy demand is independent of an available or blocked tank target',()=>{
 const production={basis:'TANK_INVENTORY_FUZZY',recorded_at:current.planning_recorded_at,
  expires_at:new Date(now+1000).toISOString(),irrigation_needed:true}
 for(const result of [{status:'READY',target_water_l:3580},{status:'BLOCKED',target_water_l:null}]){
  const source={...current,production_fuzzy:{...production,...result}}
  assert.equal(fuzzyIrrigationEstimate(source,now)?.valueL,600)
 }
 assert.equal(fuzzyIrrigationEstimate({...current,fuzzy_preview:null,
  production_fuzzy:{...production,status:'READY',target_water_l:3580}},now),null)
 const guide={...production,basis:'VERIFIED_GUIDE_FUZZY',status:'READY',target_water_l:844}
 assert.equal(fuzzyIrrigationEstimate({...current,production_fuzzy:guide},now)?.valueL,844)
})

test('tank display takes the median of distinct recent valid readings and expires historical data',()=>{
 const sample=(seconds,valueL,levelStatus='ESTIMATED')=>({...current,
  planning_recorded_at:new Date(now+seconds*1000).toISOString(),
  tank_preview:{level_status:levelStatus,estimated_available_l:valueL}})
 let readings=[]
 for(const reading of [sample(-90,800),sample(-60,3500),sample(-30,4900),sample(0,3580),sample(0,3580)]){
  readings=recentTankReadings(readings,reading,now)
 }
 const invalid=sample(1,0,'UNVERIFIED')
 assert.deepEqual(tankDisplayEstimate(readings,invalid,now+1000),{
  valueL:3580,recordedAt:current.planning_recorded_at,sampleCount:3,current:false,
 })
 assert.equal(tankDisplayEstimate(readings,sample(0,3580),now)?.current,true)
 assert.equal(tankDisplayEstimate(readings,invalid,now+120001),null)
 assert.equal(tankDisplayEstimate([],sample(0,0),now)?.valueL,0)
})

