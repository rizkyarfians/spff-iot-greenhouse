import test from 'node:test'
import assert from 'node:assert/strict'
import {guideActivityDate,guideCalendarMonth,shiftGuideMonth,guideTaskSummary} from '../src/guideSchedule.ts'
test('activity dates preserve planting day zero, preplant activities and month boundaries',()=>{
 assert.equal(guideActivityDate('2026-10-18',0),'2026-10-18')
 assert.equal(guideActivityDate('2026-10-18',10),'2026-10-28')
 assert.equal(guideActivityDate('2026-10-18',20),'2026-11-07')
 assert.equal(guideActivityDate('2026-01-05',-10),'2025-12-26')
 assert.equal(guideActivityDate('2024-02-28',1),'2024-02-29')
})
test('calendar starts Monday and includes every date once with complete weeks',()=>{
 const cells=guideCalendarMonth('2026-11')
 assert.equal(cells[0].date,'2026-10-26')
 assert.equal(cells.filter(d=>d.inMonth).length,30)
 assert.equal(new Set(cells.map(d=>d.date)).size,cells.length)
 assert.equal(cells.length%7,0)
 assert.equal(guideCalendarMonth('2024-02').filter(d=>d.inMonth).length,29)
})
test('calendar navigation crosses year boundaries without day overflow',()=>{
 assert.equal(shiftGuideMonth('2026-12',1),'2027-01')
 assert.equal(shiftGuideMonth('2026-01',-1),'2025-12')
})

test('unfinished activities remain actionable after their scheduled HST',()=>{
 const activities=[{id:'feeding',hst:10},{id:'foliar',hst:10},{id:'zpt',hst:10},{id:'later',hst:20},{id:'unknown',hst:null}]
 const summary=guideTaskSummary({plan:{activities},hst:11,completedActivityIds:['foliar']})
 assert.deepEqual(summary.pending.map(a=>a.id),['feeding','zpt'])
 assert.equal(summary.done.length,1)
 assert.equal(summary.due.length,3)
 assert.equal(summary.next.id,'later')
})
