import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import type { Alarm } from '../types';
import { formatDateTime } from '../utils/format';
import { EmptyState } from './Feedback';

const icons = { info: Info, warning: AlertTriangle, critical: CircleAlert };
export function AlarmItem({ alarm, onClick }: { alarm: Alarm; onClick: (alarm: Alarm) => void }) {
  const Icon = icons[alarm.severity];
  return <button className="alarm-item" onClick={() => onClick(alarm)}><span className={`alarm-icon severity-${alarm.severity}`}><Icon /></span><span><strong>{alarm.title}</strong><small>{alarm.description}</small><time>{formatDateTime(alarm.createdAt)}</time></span></button>;
}
export function AlarmPanel({ alarms, onDetail, onSelect }: { alarms: Alarm[]; onDetail: () => void; onSelect: (alarm: Alarm) => void }) {
  return <section className="card alarm-card" aria-labelledby="alarm-title"><div className="panel-heading"><h2 id="alarm-title">Alarm</h2><button className="text-button" onClick={onDetail}>Lihat Detail</button></div>{alarms.length ? <div className="alarm-list">{alarms.map((alarm) => <AlarmItem key={alarm.id} alarm={alarm} onClick={onSelect} />)}</div> : <EmptyState message="Tidak ada alarm aktif." />}</section>;
}
