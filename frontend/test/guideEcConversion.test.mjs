import test from 'node:test'
import assert from 'node:assert/strict'
import {guideEcProfileSchema,guideEcRecipe,convertGuideEc} from '@spff/contracts'
const input={expectedProgramRevision:1,expectedProfileRevision:0,activityId:'row-10',sourceReference:'Synthetic fixture, not for production',referenceWaterEcMsCm:0.1,temperatureCompensated25C:true,mixtureVerified:true,points:[{concentrationGPerL:0,ecMsCm:0.1},{concentrationGPerL:1,ecMsCm:1},{concentrationGPerL:2,ecMsCm:1.9}]}
const profile={...input,recipeKey:'fixture',revision:1,updatedBy:'test',updatedAt:'2026-10-28T00:00:00Z'}
const req=(product,amount)=>({row:10,product,amount,unit:'kg',waterL:null,warnings:[]})
const activity={id:'row-10',hst:10,title:'Feeding',method:'Kocor',waterL:1000,requirements:[req('A',1),req('B',2)],sourceRows:[10,11],warnings:[]}
test('EC conversion interpolates measured points and adds site water only after subtracting reference baseline',()=>{
 assert.equal(guideEcProfileSchema.safeParse(input).success,true)
 assert.ok(Math.abs(convertGuideEc(1,0.3,profile)-1.2)<1e-12)
 assert.ok(Math.abs(convertGuideEc(1.5,0.3,profile)-1.65)<1e-12)
 assert.equal(convertGuideEc(0,0.3,profile),0.3)
 assert.equal(convertGuideEc(2.01,0.3,profile),null)
 assert.equal(convertGuideEc(NaN,0.3,profile),null)
 assert.equal(convertGuideEc(1,-1,profile),null)
})
test('EC profiles reject decreasing/duplicate points, invented manual targets and missing verification',()=>{
 for(const patch of [{points:[input.points[1],input.points[2]]},{points:[input.points[0],input.points[0]]},{points:[input.points[0],{concentrationGPerL:1,ecMsCm:0}]},{mixtureVerified:false},{temperatureCompensated25C:false},{targetEcMsCm:1.2}])assert.equal(guideEcProfileSchema.safeParse({...input,...patch}).success,false)
 assert.equal(convertGuideEc(1,0.3,{...profile,points:[profile.points[1],profile.points[0]]}),null)
})
test('recipe matching distinguishes products and ratios while reusing proportionally scaled batches',()=>{
 const recipe=guideEcRecipe(activity)
 assert.equal(recipe.concentrationGPerL,3)
 const batch={...activity,waterL:500,requirements:[req('A',0.5),req('B',1)]}
 assert.equal(guideEcRecipe(batch).key,recipe.key)
 assert.equal(guideEcRecipe(batch).concentrationGPerL,3)
 assert.notEqual(guideEcRecipe({...activity,requirements:[req('A',2),req('B',1)]}).key,recipe.key)
 assert.notEqual(guideEcRecipe({...activity,requirements:[req('C',1),req('B',2)]}).key,recipe.key)
 assert.equal(guideEcRecipe({...activity,requirements:[req('B',2),req('A',1)]}).key,recipe.key)
})
test('conversion blocks missing water, mixed liquid units, source warnings and different per-product water',()=>{
 for(const patch of [{waterL:null},{warnings:['Ambiguous recipe']},{requirements:[{...req('A',1),unit:'mL'}]},{requirements:[{...req('A',1),waterL:200}]},{requirements:[{...req('A',1),amount:null}]}])assert.equal(guideEcRecipe({...activity,...patch}),null)
})
