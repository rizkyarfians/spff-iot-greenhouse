import { ArrowUpRight, Droplet, FlaskConical, Gauge, Waves } from 'lucide-react';
import type { HealthStatus, Sensor } from '../types';
import { formatTime } from '../utils/format';

const labels: Record<HealthStatus, string> = { good: 'Good', warning: 'Warning', critical: 'Critical', offline: 'Offline' };
export function SensorStatusBadge({ status }: { status: HealthStatus }) { return <span className={`badge badge-${status}`}>{labels[status]}</span>; }
const icons = { ph: FlaskConical, ec: Gauge, waterTank: Droplet, nutrientTank: Waves, temperature: Gauge, soilMoisture: Droplet };

export function SensorCard({ sensor, onDetail }: { sensor: Sensor; onDetail: (sensor: Sensor) => void }) {
  const Icon = icons[sensor.type];
  return <article className="card sensor-card"><div className="sensor-card-head"><div className="sensor-title"><Icon size={19} /><span>{sensor.name}</span></div><button className="detail-icon" onClick={() => onDetail(sensor)} aria-label={`Lihat detail ${sensor.name}`}><ArrowUpRight /></button></div><div className="sensor-value"><strong>{new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(sensor.value)}</strong><small>{sensor.unit}</small><SensorStatusBadge status={sensor.status} /></div><p>Update terakhir {formatTime(sensor.updatedAt)}</p></article>;
}
