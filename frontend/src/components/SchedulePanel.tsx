import { CalendarClock, ChevronRight } from 'lucide-react';
import type { Schedule } from '../types';
import { formatTime } from '../utils/format';
import { EmptyState } from './Feedback';

export function ScheduleItem({ schedule, onClick }: { schedule: Schedule; onClick: (schedule: Schedule) => void }) {
  return <button className="schedule-item" onClick={() => onClick(schedule)}><span className="schedule-icon"><CalendarClock /></span><span className="schedule-copy"><strong>{schedule.name}</strong><small>{schedule.zone}</small></span><span className="today-badge">{schedule.status === 'today' ? 'Hari ini' : 'Mendatang'}</span><time>{formatTime(schedule.scheduledAt)}</time><ChevronRight size={16} /></button>;
}
export function SchedulePanel({ schedules, onDetail, onSelect }: { schedules: Schedule[]; onDetail: () => void; onSelect: (schedule: Schedule) => void }) {
  return <section className="card schedule-card" aria-labelledby="schedule-title"><div className="panel-heading"><h2 id="schedule-title">Jadwal</h2><button className="text-button" onClick={onDetail}>Lihat Detail</button></div>{schedules.length ? <div className="schedule-list">{schedules.map((item) => <ScheduleItem key={item.id} schedule={item} onClick={onSelect} />)}</div> : <EmptyState message="Belum ada jadwal." />}</section>;
}
