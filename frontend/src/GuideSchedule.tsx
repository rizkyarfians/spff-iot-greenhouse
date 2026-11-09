import { useId, useState } from 'react'
import type { GuideProgram, GuideEcConversion } from '@spff/contracts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supportsFertigationAutomation } from './fertigationSupport'
import { GuideEcTarget } from './GuideEcTarget'
import { guideActivityDate, guideCalendarWeek } from './guideSchedule.ts'
import './GuideSchedule.css'

const calendarDate = (date: string) => new Date(`${date}T00:00:00Z`)
const fullDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeZone: 'UTC' })
const shortDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const rangeDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' })
const quantity = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 })

export function GuideSchedule({ program, conversions = [] }: {
  program: GuideProgram
  conversions?: GuideEcConversion[]
}) {
  const today = guideActivityDate(program.config.plantingDate, program.hst)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const chosen = selectedDate ?? today
  const detailsId = useId()
  const week = guideCalendarWeek(chosen)
  const isCurrentWeek = week.includes(today)
  const upcomingEnd = guideActivityDate(today, 30)
  const completed = new Set(program.completedActivityIds)
  const activities = program.plan.activities.flatMap(activity => activity.hst === null ? [] : [{
    ...activity,
    date: guideActivityDate(program.config.plantingDate, activity.hst),
  }])
  const upcoming = activities.filter(activity => activity.date > today && activity.date <= upcomingEnd && !completed.has(activity.id))
    .sort((a, b) => a.date.localeCompare(b.date))
  const selected = activities.filter(activity => activity.date === chosen)
  const weekLabel = rangeDate.formatRange(calendarDate(week[0]), calendarDate(week[6]))

  return (
    <section className="gp-week-schedule" aria-label="Jadwal kegiatan tanaman">
      <div className="gp-panel gp-week-upcoming">
        <div>
          <h3>Kegiatan Mendatang</h3>
          <p>30 hari ke depan</p>
        </div>
        {upcoming.length > 0 ? (
          <ul className="gp-week-upcoming-list" aria-label="Kegiatan dalam 30 hari ke depan">
            {upcoming.map(activity => (
              <li key={activity.id}>
                <button type="button" className="gp-week-event" aria-controls={detailsId}
                  onClick={() => setSelectedDate(activity.date)}>
                  <time dateTime={activity.date}>{shortDate.format(calendarDate(activity.date))}</time>
                  <span><strong>{activity.title}</strong><small>HST {activity.hst} · {activity.method}</small></span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="gp-week-empty">Tidak ada kegiatan dalam 30 hari ke depan.</p>}
      </div>

      <div className="gp-panel gp-week-calendar">
        <div className="gp-week-toolbar">
          <div className="gp-week-navigation">
            <button type="button" className="gp-week-arrow" aria-label="Minggu sebelumnya"
              onClick={() => setSelectedDate(guideActivityDate(chosen, -7))}>
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <div aria-live="polite">
              <h3>{isCurrentWeek ? 'Minggu Ini' : 'Jadwal Mingguan'}</h3>
              <p>{weekLabel}</p>
            </div>
            <button type="button" className="gp-week-arrow" aria-label="Minggu berikutnya"
              onClick={() => setSelectedDate(guideActivityDate(chosen, 7))}>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="gp-week-today" onClick={() => setSelectedDate(null)}>Hari ini</button>
        </div>

        <div className="gp-week-days" role="group" aria-label="Pilih hari kegiatan">
          {week.map(date => {
            const day = calendarDate(date)
            const events = activities.filter(activity => activity.date === date)
            const done = events.length > 0 && events.every(activity => completed.has(activity.id))
            const status = done ? 'Selesai' : date <= today ? 'Belum selesai' : 'Akan datang'
            const tone = done ? 'done' : date <= today ? 'pending' : 'next'
            const isToday = date === today

            return (
              <button type="button" key={date} className="gp-week-day" data-weekend={day.getUTCDay() % 6 === 0}
                aria-pressed={chosen === date} aria-current={isToday ? 'date' : undefined} aria-controls={detailsId}
                aria-label={`${fullDate.format(day)}, ${events.length ? `${events.length} kegiatan, ${status.toLowerCase()}` : 'tidak ada kegiatan'}`}
                onClick={() => setSelectedDate(date)}>
                <span className="gp-week-day-heading">
                  <span>{weekday.format(day)}</span>
                  {isToday && <span className="gp-week-today-tag">Hari ini</span>}
                </span>
                <time className="gp-week-day-number" dateTime={date}>{day.getUTCDate()}</time>
                {events.length > 0 ? (
                  <>
                    <span className="gp-week-activity-name">{events[0].title}</span>
                    {events.length > 1 && <span className="gp-week-day-meta">+{events.length - 1} kegiatan</span>}
                    <span className={`gp-week-badge is-${tone}`}>{status}</span>
                  </>
                ) : <span className="gp-week-day-meta">Tidak ada kegiatan</span>}
              </button>
            )
          })}
        </div>
      </div>

      <section className="gp-panel gp-week-details" id={detailsId} aria-label="Detail hari terpilih">
        <header className="gp-week-details-header">
          <div>
            <h3>Detail Kegiatan</h3>
            <p>{fullDate.format(calendarDate(chosen))}</p>
          </div>
          <span className="gp-week-total">{selected.length} kegiatan</span>
        </header>
        {selected.length === 0 && <p className="gp-week-empty">Tidak ada kegiatan terjadwal pada tanggal ini.</p>}
        <div className="gp-week-detail-list">
          {selected.map(activity => {
            const tone = completed.has(activity.id) ? 'done' : activity.date <= today ? 'pending' : 'next'
            const status = tone === 'done' ? 'Selesai' : tone === 'pending' ? 'Belum selesai' : 'Akan datang'

            return (
              <article className="gp-week-detail" key={activity.id}>
                <div className="gp-week-detail-tags">
                  <span className="gp-week-total">HST {activity.hst}</span>
                  <span className={`gp-week-badge is-${tone}`}>{status}</span>
                </div>
                <h4>{activity.title}</h4>
                <p>{activity.method}</p>
                {supportsFertigationAutomation(activity) && (
                  <GuideEcTarget activity={activity} conversion={conversions.find(row => row.activityId === activity.id)} />
                )}
                {activity.requirements.length > 0 && (
                  <dl>
                    {activity.requirements.map(requirement => (
                      <div key={requirement.row}>
                        <dt>{requirement.product}</dt>
                        <dd>{requirement.amount === null ? '—' : `${quantity.format(requirement.amount)} ${requirement.unit}`}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {activity.waterL !== null && <p>Larutan {quantity.format(activity.waterL)} L</p>}
              </article>
            )
          })}
        </div>
        {program.plan.activities.some(activity => activity.hst === null) && (
          <p className="gp-warning">Ada kegiatan tanpa HST. Periksa di Semua kegiatan.</p>
        )}
      </section>
    </section>
  )
}
