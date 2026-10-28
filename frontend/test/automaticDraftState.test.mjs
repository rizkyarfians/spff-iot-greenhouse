import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeAutomaticDraft} from '../src/automaticDraftState.ts'
test('live server refresh does not silently enable, disable or erase an edited sensor rule',()=>{
 const server={water:{enabled:true,low:10},fertilizer:{enabled:false}}
 const local={water:{enabled:false,low:20},fertilizer:{enabled:false}}
 const next={water:{enabled:true,low:15},fertilizer:{enabled:true}}
 assert.equal(mergeAutomaticDraft(local,JSON.stringify(server),JSON.stringify(next)),local)
 assert.deepEqual(mergeAutomaticDraft(server,JSON.stringify(server),JSON.stringify(next)),next)
 assert.deepEqual(mergeAutomaticDraft(local,JSON.stringify(local),JSON.stringify(next)),next)
})
