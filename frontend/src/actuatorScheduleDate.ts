import type { ApiSchedule } from '@spff/contracts'

const calendarDay = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)

export function isScheduleToday(schedule: ApiSchedule, now: Date): boolean {
  if (!schedule.enabled) return false
  if (schedule.repeatRule === 'once') return schedule.runDate === calendarDay(now, schedule.timezone)
  if (schedule.repeatRule === 'daily') return true
  const weekday = new Intl.DateTimeFormat('en', { timeZone: schedule.timezone, weekday: 'short' }).format(now)
  const weekend = weekday === 'Sat' || weekday === 'Sun'
  return schedule.repeatRule === 'weekends' ? weekend : !weekend
}

export function isOneTimeSchedulePast(schedule: ApiSchedule, now: Date): boolean {
  if (schedule.repeatRule !== 'once' || !schedule.runDate) return false
  const today = calendarDay(now, schedule.timezone)
  if (schedule.runDate !== today) return schedule.runDate < today
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now)
  return time >= schedule.offTime
}
