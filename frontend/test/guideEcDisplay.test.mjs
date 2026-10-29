import test from 'node:test'
import assert from 'node:assert/strict'
import {guideEcDisplay} from '../src/guideEcDisplay.ts'
const ready={status:'ready',targetEcMsCm:1.25}
test('solution target is visible regardless of automation support',()=>{
 for(const method of ['Kocor','Semprot','Tetes']){
  assert.equal(guideEcDisplay({method,waterL:100},ready).target,1.25)
 }
})
test('dry application never presents a fabricated EC even if stale data has a target',()=>{
 for(const method of ['Tabur','Tugal',' tabur '])assert.equal(guideEcDisplay({method,waterL:100},ready).kind,'dry')
 assert.equal(guideEcDisplay({method:'Semprot',waterL:null},ready).target,null)
})
test('unavailable profiles and water baselines are distinguished from zero EC',()=>{
 const activity={method:'Semprot',waterL:100}
 assert.equal(guideEcDisplay(activity,{status:'blocked',reason:'EC air baku belum diisi'}).label,'Isi EC air baku')
 assert.equal(guideEcDisplay(activity,{status:'blocked',reason:'Profil konversi belum tersedia'}).label,'Profil campuran belum tersedia')
 assert.equal(guideEcDisplay(activity).target,null)
})
