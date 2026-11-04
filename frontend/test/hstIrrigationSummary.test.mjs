import test from 'node:test'
import assert from 'node:assert/strict'
import {hstIrrigationDisplay} from '../src/hstIrrigationSummary.ts'
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
 assert.match(result.label,/Kebutuhan penyiraman/)
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
