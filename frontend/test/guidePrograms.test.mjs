import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildGuideProgramPlan,guideProgramHst,guideProgramConfigSchema} from '@spff/contracts'
const source=JSON.parse(readFileSync(new URL('../src/data/protocolGuide.json',import.meta.url),'utf8'))
const config=(cropId,quantity=1000,basis='plants')=>({cropId,quantity,basis,plantingDate:'2026-10-01',deviceId:null})
const plan=(cropId,quantity,basis)=>buildGuideProgramPlan(source.sheets.find(s=>s.id===cropId),config(cropId,quantity,basis))
test('guide programs compute plant-based and area-based quantities from immutable source doses',()=>{
 const original=JSON.stringify(source)
 const plants=plan('ubi-jalar',1000),area=plan('ubi-jalar',250,'area')
 assert.equal(plants.activities[0].requirements[0].amount,2.5)
 assert.equal(plants.activities[0].requirements[0].unit,'kg')
 assert.equal(plants.activities[0].requirements[0].sourceAmount,50)
 assert.equal(plants.activities[0].waterL,null)
 assert.equal(area.activities[0].requirements[0].amount,2.5)
 assert.equal(area.plants,1000);assert.equal(area.area,250)
 assert.equal(JSON.stringify(source),original)
})
test('shared water is not summed per product; foliar and pesticide activities stay separate',()=>{
 const buncis=plan('buncis',14000)
 const feeding=buncis.activities[0],spray=buncis.activities.find(a=>a.id==='row-12')
 assert.equal(feeding.waterL,2800);assert.equal(feeding.requirements.length,2)
 assert.ok(Math.abs(feeding.requirements[0].amount-6.25)<0.00001)
 assert.equal(spray.waterL,100);assert.equal(spray.requirements.length,5)
 assert.equal(spray.method,'Semprot');assert.equal(spray.requirements[0].amount,100);assert.equal(spray.requirements[0].unit,'mL')
 assert.equal(feeding.requirements[0].concentrationGPerL,2.232142857)
})
test('conventional per-plant feeding stays distinct from EC and preserves rounded source totals',()=>{
 const terong=plan('terong',6000),feeding=terong.activities[0]
 assert.equal(feeding.waterL,1200);assert.equal(feeding.requirements[0].amount,7.98)
 assert.equal(feeding.requirements[0].sourceAmount,8)
 assert.equal(feeding.requirements[0].concentrationGPerL,6.65)
 assert.ok(feeding.requirements[0].warnings.length===0)
 assert.equal('ecTargetUsCm'in feeding,false)
})
test('ambiguous rows, inconsistent units and negative pre-planting HST are surfaced',()=>{
 const kacang=plan('kacang-tanah',43750)
 assert.equal(kacang.activities[0].hst,-10)
 const irregular=kacang.activities.flatMap(a=>a.requirements).find(r=>r.row===21)
 assert.equal(irregular.unit,'g');assert.equal(irregular.amount,50)
 assert.ok(irregular.warnings.some(w=>w.includes('Satuan kebutuhan')))
 const terong=plan('terong',6000)
 assert.ok(terong.activities.find(a=>a.id==='row-34').warnings.includes('HST belum diisi.'))
 assert.ok(terong.activities.find(a=>a.id==='row-30').warnings.some(w=>w.includes('Keterangan')))
})
test('HST uses WIB midnight, validates calendar dates and permits pre-planting programs',()=>{
 assert.equal(guideProgramHst('2026-10-28',new Date('2026-10-28T16:59:59Z')),0)
 assert.equal(guideProgramHst('2026-10-28',new Date('2026-10-28T17:00:00Z')),1)
 assert.equal(guideProgramHst('2026-11-01',new Date('2026-10-28T02:00:00Z')),-4)
 assert.equal(guideProgramConfigSchema.safeParse({...config('terong'),plantingDate:'2026-02-30'}).success,false)
 assert.equal(guideProgramConfigSchema.safeParse(config('terong',1.5)).success,false)
 assert.equal(guideProgramConfigSchema.safeParse(config('terong',1.5,'area')).success,true)
})
