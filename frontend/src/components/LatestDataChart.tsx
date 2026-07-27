import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSensorHistory } from '../hooks/useSensorHistory';
import type { SensorType } from '../types';
import { EmptyState, LoadingSkeleton } from './Feedback';

const options: { value: SensorType; label: string }[] = [
  { value: 'ph', label: 'pH' }, { value: 'ec', label: 'EC' }, { value: 'temperature', label: 'Suhu' },
  { value: 'soilMoisture', label: 'Kelembapan Tanah' }, { value: 'waterTank', label: 'Tangki Air' }, { value: 'nutrientTank', label: 'Tangki Nutrisi' },
];
export function LatestDataChart() {
  const [type, setType] = useState<SensorType>('ph');
  const { data, loading, error } = useSensorHistory(type);
  return <section className="card chart-card" aria-labelledby="chart-title"><div className="panel-heading"><div><p className="eyebrow">Monitoring sensor</p><h2 id="chart-title">Latest Data</h2></div><label className="sr-only" htmlFor="sensor-select">Pilih sensor</label><select id="sensor-select" value={type} onChange={(e) => setType(e.target.value as SensorType)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="chart-wrap">{loading ? <LoadingSkeleton className="chart-skeleton" /> : error ? <EmptyState message={error} /> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 8, left: -28, bottom: 0 }}><defs><linearGradient id="sensorFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#26AC6D" stopOpacity={0.3}/><stop offset="100%" stopColor="#26AC6D" stopOpacity={0.03}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#eeeeee" /><XAxis dataKey="time" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} /><Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e6e6e6' }} /><Area type="monotone" dataKey="value" stroke="#26AC6D" strokeWidth={2.5} fill="url(#sensorFill)" dot={{ r: 3.5, fill: '#26AC6D', strokeWidth: 0 }} activeDot={{ r: 6 }} /></AreaChart></ResponsiveContainer>}</div></section>;
}
