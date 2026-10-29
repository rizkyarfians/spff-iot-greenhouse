import test from 'node:test'
import assert from 'node:assert/strict'
import {supportsFertigationAutomation,automaticGuideActivities} from '../src/fertigationSupport.ts'
test('only kocor receives automation recommendations, regardless of EC profile availability',()=>{
 for(const method of ['Kocor',' kocor '])assert.equal(supportsFertigationAutomation({method}),true)
 for(const method of ['Semprot','Tabur','Tugal','Tetes','Belum ditentukan',''])assert.equal(supportsFertigationAutomation({method}),false)
})
test('mixed programs retain manual guide tasks while recommendation list contains kocor only',()=>{
 const program={plan:{activities:[{id:'a',method:'Semprot'},{id:'b',method:'Kocor'},{id:'c',method:'Tabur'}]}}
 assert.deepEqual(automaticGuideActivities(program).map(a=>a.id),['b'])
 assert.equal(program.plan.activities.length,3)
 assert.deepEqual(automaticGuideActivities({plan:{activities:[{method:'Semprot'}]}}),[])
})
