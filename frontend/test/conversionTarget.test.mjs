import test from 'node:test'
import assert from 'node:assert/strict'
import {conversionTarget} from '../src/conversionTargetData.ts'

test('saved conversion is displayed in both units without changing its value',()=>{
 const value=conversionTarget('row-11',{activityId:'row-11',status:'ready',targetEcMsCm:2.608,concentrationGPerL:31.35})
 assert.equal(value.targetMsCm,2.608);assert.equal(value.targetUsCm,2608);assert.equal(value.concentrationGPerL,31.35)
})
test('blocked, missing and previously selected activity never become an EC target',()=>{
 for(const conversion of [undefined,{activityId:'other',status:'ready',targetEcMsCm:2.5},{activityId:'row-11',status:'blocked',targetEcMsCm:2.5,reason:'Profil konversi belum tersedia'}]){
  const value=conversionTarget('row-11',conversion);assert.equal(value.ready,false);assert.equal(value.targetMsCm,null);assert.equal(value.targetUsCm,null)
 }
})
test('zero is valid, invalid numeric targets are unavailable',()=>{
 assert.equal(conversionTarget('row-11',{activityId:'row-11',status:'ready',targetEcMsCm:0}).targetUsCm,0)
 for(const targetEcMsCm of [null,undefined,NaN,Infinity,-1])assert.equal(conversionTarget('row-11',{activityId:'row-11',status:'ready',targetEcMsCm}).ready,false)
})
// View rendering is checked by the dedicated tsx render smoke, since Node's
// built-in strip-types runner cannot load CSS imports from React components.
