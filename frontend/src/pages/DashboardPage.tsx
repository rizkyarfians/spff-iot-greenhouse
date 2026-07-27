import { useState } from 'react';
import { AlarmPanel } from '../components/AlarmPanel';
import { DashboardHeader } from '../components/DashboardHeader';
import { ErrorState, LoadingSkeleton } from '../components/Feedback';
import { LatestDataChart } from '../components/LatestDataChart';
import { DetailDrawer } from '../components/Overlay';
import { PumpStatusCard } from '../components/PumpStatusCard';
import { SchedulePanel } from '../components/SchedulePanel';
import { SensorCard } from '../components/SensorCard';
import { WeatherCard } from '../components/WeatherCard';
import { useDashboardData } from '../hooks/useDashboardData';
import type { Alarm, Schedule, Sensor } from '../types';
import { formatDateTime } from '../utils/format';

type Detail = { title: string; content: React.ReactNode } | null;
function DashboardSkeleton() {
  return <><DashboardHeader /><div className="dashboard-grid"><div className="dashboard-column"><LoadingSkeleton className="weather-card" /><div className="sensor-grid">{[1,2,3,4].map((id) => <LoadingSkeleton key={id} className="sensor-card" />)}</div></div><div className="dashboard-column"><LoadingSkeleton className="chart-card" /><LoadingSkeleton className="pump-card" /></div><div className="dashboard-column"><LoadingSkeleton className="alarm-card" /><LoadingSkeleton className="schedule-card" /></div></div></>;
}

export function DashboardPage() {
  const { data, loading, error, retry } = useDashboardData();
  const [detail, setDetail] = useState<Detail>(null);
  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) return <div><DashboardHeader /><ErrorState message={error} onRetry={() => void retry()} /></div>;
  if (!data) return null;
  const showSensor = (sensor: Sensor) => setDetail({ title: sensor.name, content: <div className="detail-content"><p className="detail-value">{sensor.value}<small>{sensor.unit}</small></p><p>Status sensor: <b>{sensor.status}</b></p><p>Terakhir diperbarui {formatDateTime(sensor.updatedAt)}</p></div> });
  const showAlarm = (alarm: Alarm) => setDetail({ title: alarm.title, content: <div className="detail-content"><span className={`badge badge-${alarm.severity === 'info' ? 'offline' : alarm.severity}`}>{alarm.severity}</span><p>{alarm.description}</p><p>{formatDateTime(alarm.createdAt)}</p></div> });
  const showSchedule = (schedule: Schedule) => setDetail({ title: schedule.name, content: <div className="detail-content"><p>Zona: <b>{schedule.zone}</b></p><p>Pelaksanaan: {formatDateTime(schedule.scheduledAt)}</p><span className="today-badge">Hari ini</span></div> });
  return <><DashboardHeader />{error && <div className="inline-warning">Pembaruan otomatis terganggu. Menampilkan data terakhir.</div>}<div className="dashboard-grid"><div className="dashboard-column"><WeatherCard weather={data.weather} /><div className="sensor-grid">{data.sensors.slice(0,4).map((sensor) => <SensorCard key={sensor.id} sensor={sensor} onDetail={showSensor} />)}</div></div><div className="dashboard-column"><LatestDataChart /><PumpStatusCard initialPumps={data.pumps} onDetail={() => setDetail({ title: 'Detail Status Pompa', content: <div className="detail-content"><p>Semua pompa diperbarui otomatis setiap 10 detik.</p>{data.pumps.map((pump) => <p key={pump.id}><b>{pump.name}</b> — {pump.state}</p>)}</div> })} /></div><div className="dashboard-column"><AlarmPanel alarms={data.alarms} onSelect={showAlarm} onDetail={() => setDetail({ title: 'Semua Alarm', content: <div className="drawer-list">{data.alarms.map((alarm) => <button key={alarm.id} onClick={() => showAlarm(alarm)}>{alarm.title}</button>)}</div> })} /><SchedulePanel schedules={data.schedules} onSelect={showSchedule} onDetail={() => setDetail({ title: 'Semua Jadwal', content: <div className="drawer-list">{data.schedules.map((schedule) => <button key={schedule.id} onClick={() => showSchedule(schedule)}>{schedule.name}</button>)}</div> })} /></div></div><DetailDrawer open={Boolean(detail)} title={detail?.title ?? ''} onClose={() => setDetail(null)}>{detail?.content}</DetailDrawer></>;
}
