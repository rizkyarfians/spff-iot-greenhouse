import test from 'node:test'
import assert from 'node:assert/strict'
import {scheduleDuration} from '../src/scheduleTimeSummary.ts'
test('schedule preview describes the exact same-day pump runtime',()=>{
 assert.equal(scheduleDuration('07:15','07:17'),'2 menit')
 assert.equal(scheduleDuration('07:00','08:00'),'1 jam')
 assert.equal(scheduleDuration('07:15','08:45'),'1 jam 30 menit')
 assert.equal(scheduleDuration('00:00','23:59'),'23 jam 59 menit')
 for(const [start,end] of [['07:15','07:15'],['23:00','01:00'],['25:00','26:00'],['','07:15']])assert.equal(scheduleDuration(start,end),null)
})
