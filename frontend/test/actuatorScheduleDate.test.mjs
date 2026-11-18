import assert from 'node:assert/strict'
import test from 'node:test'
import { isScheduleRemainingToday } from '../src/actuatorScheduleDate.ts'

const schedule = {
  enabled: true,
  repeatRule: 'once',
  runDate: '2026-11-18',
  timezone: 'Asia/Jakarta',
  onTime: '14:40',
  offTime: '14:45',
}

test('dashboard drops the occurrence at its scheduled end in local time', () => {
  for (const [utcTime, visible] of [
    ['07:39:59', true],
    ['07:40:00', true],
    ['07:44:59', true],
    ['07:45:00', false],
    ['08:56:00', false],
  ]) {
    assert.equal(isScheduleRemainingToday(schedule, new Date(`2026-11-18T${utcTime}Z`)), visible)
  }
})

test('dashboard respects the occurrence date and recurrence rule', () => {
  const wednesday = new Date('2026-11-18T07:00:00Z')
  assert.equal(isScheduleRemainingToday({ ...schedule, enabled: false }, wednesday), false)
  assert.equal(isScheduleRemainingToday({ ...schedule, runDate: '2026-11-19' }, wednesday), false)
  assert.equal(isScheduleRemainingToday({ ...schedule, repeatRule: 'weekends' }, wednesday), false)
  assert.equal(isScheduleRemainingToday({ ...schedule, repeatRule: 'weekdays' }, wednesday), true)
  assert.equal(isScheduleRemainingToday({ ...schedule, repeatRule: 'daily' },
    new Date('2026-11-19T07:00:00Z')), true)
})
