import test from 'node:test'
import assert from 'node:assert/strict'
import {missingProgramField,programFieldStep} from '../src/programWizard.ts'
test('guided program requires dated targets, preserves valid zero and only asks EC for fertilizer programs',()=>{
 const water={cropId:'sweet-potato',plantingDate:'2026-10-28',hstFrom:'0',hstTo:'30',moistureLowPercent:'0',moistureTargetPercent:'60'}
 assert.equal(missingProgramField(water,false),undefined)
 assert.equal(missingProgramField({...water,plantingDate:''},false),'plantingDate')
 assert.equal(missingProgramField(water,true),'ecLowUsCm')
 assert.equal(missingProgramField({...water,ecLowUsCm:'100',ecTargetUsCm:'200',ecHighUsCm:'300'},true),undefined)
 assert.equal(missingProgramField({...water,moistureLowPercent:'  '},false),'moistureLowPercent')
 assert.equal(programFieldStep('plantingDate'),0)
 assert.equal(programFieldStep('ecTargetUsCm'),1)
 assert.equal(programFieldStep('triggerSampleCount'),1)
})
