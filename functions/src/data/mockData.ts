import type { Alarm, HistoryPoint, Pump, Schedule, Sensor, SensorType, Weather } from '../types/index.js';

const now = () => new Date().toISOString();
export const weather: Weather = { location: 'Dummy Location', temperature: 24, condition: 'Cerah', date: now() };
export const sensors: Sensor[] = [
  { id: 'sensor-ph', type: 'ph', name: 'pH Tanah', value: 7.2, unit: '', status: 'good', updatedAt: now() },
  { id: 'sensor-ec', type: 'ec', name: 'EC', value: 1.62, unit: 'mS/cm', status: 'good', updatedAt: now() },
  { id: 'sensor-water', type: 'waterTank', name: 'Tangki Air', value: 78, unit: '%', status: 'good', updatedAt: now() },
  { id: 'sensor-nutrient', type: 'nutrientTank', name: 'Tangki Nutrisi', value: 80, unit: '%', status: 'good', updatedAt: now() },
  { id: 'sensor-temperature', type: 'temperature', name: 'Suhu Udara', value: 24, unit: '°C', status: 'good', updatedAt: now() },
  { id: 'sensor-moisture', type: 'soilMoisture', name: 'Kelembapan Tanah', value: 68, unit: '%', status: 'good', updatedAt: now() },
];
const baseHistory: Record<SensorType, number[]> = {
  ph: [6.8, 7.05, 7.12, 7.08, 7.2, 7.35, 7.22, 7.01, 7.08],
  ec: [1.3, 1.42, 1.55, 1.48, 1.62, 1.71, 1.65, 1.58, 1.62],
  temperature: [21, 22, 24, 25, 27, 26, 25, 24, 24],
  soilMoisture: [55, 62, 70, 72, 68, 66, 69, 71, 68],
  waterTank: [92, 89, 87, 84, 82, 80, 79, 78, 78],
  nutrientTank: [94, 92, 90, 87, 85, 82, 81, 80, 80],
};
const times = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
export const histories = Object.fromEntries(Object.entries(baseHistory).map(([type, values]) => [type, values.map((value, index): HistoryPoint => ({ time: times[index], value }))])) as Record<SensorType, HistoryPoint[]>;
export const pumps: Pump[] = [
  { id: 'pump-nutrient', name: 'Pompa Nutrisi', isActive: true, state: 'active', activeDuration: '05:03:00', updatedAt: now() },
  { id: 'pump-nutrient-mc', name: 'Pompa Nutrisi (MC)', isActive: true, state: 'active', activeDuration: '05:03:00', updatedAt: now() },
  { id: 'pump-watering', name: 'Pompa Penyiraman', isActive: false, state: 'inactive', activeDuration: '00:00:00', updatedAt: now() },
];
export const alarms: Alarm[] = [
  { id: 'alarm-ec-1', title: 'EC Mendekati Batas', description: 'Nilai EC tanah 1,82 mS/cm mendekati batas maksimum.', severity: 'warning', acknowledged: false, createdAt: now() },
  { id: 'alarm-water', title: 'Tangki Air B Menurun', description: 'Ketinggian Tangki B 42%. Disarankan melakukan pengisian.', severity: 'info', acknowledged: false, createdAt: now() },
  { id: 'alarm-ec-2', title: 'EC Mendekati Batas', description: 'Kenaikan EC terdeteksi pada zona nutrisi 2.', severity: 'critical', acknowledged: false, createdAt: now() },
];
const todayAt = (hour: number) => { const value = new Date(); value.setHours(hour, 0, 0, 0); return value.toISOString(); };
export const schedules: Schedule[] = [
  { id: 'schedule-nutrient', name: 'Penyiraman Nutrisi', scheduledAt: todayAt(14), zone: 'Zona Nutrisi', status: 'today' },
  { id: 'schedule-fill', name: 'Pengisian Tangki', scheduledAt: todayAt(16), zone: 'Tangki Air B', status: 'today' },
  { id: 'schedule-zone-1', name: 'Penyiraman Zona 1', scheduledAt: todayAt(18), zone: 'Zona 1', status: 'today' },
];
