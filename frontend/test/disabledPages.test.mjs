import test from 'node:test'
import assert from 'node:assert/strict'
import {isPageEnabled,pageTitles} from '../src/pageConfig.ts'
test('Smart Soil is disabled while other application pages stay available',()=>{
 assert.equal(isPageEnabled('smart-soil'),false)
 for(const page of Object.keys(pageTitles).filter(p=>p!=='smart-soil'))assert.equal(isPageEnabled(page),true)
})
