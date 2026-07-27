import { api } from '../api/client';
import type { Alarm, ApiResponse, DashboardData, HistoryPoint, Pump, Schedule, Sensor, SensorType } from '../types';

export const dashboardService = {
  dashboard: () => api.get<ApiResponse<DashboardData>>('/dashboard').then((r) => r.data.data),
  sensors: () => api.get<ApiResponse<Sensor[]>>('/sensors').then((r) => r.data.data),
  history: (type: SensorType) => api.get<ApiResponse<HistoryPoint[]>>('/sensors/history', { params: { type, range: 'day' } }).then((r) => r.data.data),
  pumps: () => api.get<ApiResponse<Pump[]>>('/pumps').then((r) => r.data.data),
  updatePump: (id: string, isActive: boolean) => api.patch<ApiResponse<Pump>>(`/pumps/${id}`, { isActive }).then((r) => r.data.data),
  alarms: () => api.get<ApiResponse<Alarm[]>>('/alarms', { params: { limit: 3 } }).then((r) => r.data.data),
  acknowledgeAlarm: (id: string) => api.patch<ApiResponse<Alarm>>(`/alarms/${id}/acknowledge`).then((r) => r.data.data),
  schedules: () => api.get<ApiResponse<Schedule[]>>('/schedules').then((r) => r.data.data),
};
