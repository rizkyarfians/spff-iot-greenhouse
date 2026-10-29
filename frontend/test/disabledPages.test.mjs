import test from 'node:test'
import assert from 'node:assert/strict'
import {isPageEnabled,pageTitles,pageDestination} from '../src/pageConfig.ts'
test('Smart Soil and Settings are hidden while operational pages stay available',()=>{
 assert.equal(isPageEnabled('smart-soil'),false)
 assert.equal(isPageEnabled('settings'),false)
 for(const page of Object.keys(pageTitles).filter(p=>!['smart-soil','settings'].includes(p)))assert.equal(isPageEnabled(page),true)
})
test('old Settings links go to Controls and Smart Soil links go to Dashboard',()=>{
 assert.equal(pageDestination('settings'),'controls')
 assert.equal(pageDestination('smart-soil'),'dashboard')
 assert.equal(pageDestination('alarms'),'alarms')
})
