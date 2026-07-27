import { alarms, histories, pumps, schedules, sensors, weather } from '../data/mockData.js';
import type { Pump, SensorType, Severity } from '../types/index.js';

export const repository = {
  dashboard: () => ({ weather: { ...weather, date: new Date().toISOString() }, sensors, pumps, alarms, schedules }),
  sensors: () => sensors,
  history: (type: SensorType) => histories[type],
  pumps: () => pumps,
  updatePump: (id: string, isActive: boolean): Pump | null => {
    const pump = pumps.find((item) => item.id === id);
    if (!pump) return null;
    pump.isActive = isActive; pump.state = isActive ? 'active' : 'inactive'; pump.updatedAt = new Date().toISOString();
    pump.activeDuration = isActive ? pump.activeDuration : '00:00:00';
    return pump;
  },
  alarms: (filters: { severity?: Severity; acknowledged?: boolean; limit?: number }) => alarms
    .filter((alarm) => !filters.severity || alarm.severity === filters.severity)
    .filter((alarm) => filters.acknowledged === undefined || alarm.acknowledged === filters.acknowledged)
    .slice(0, filters.limit ?? alarms.length),
  acknowledge: (id: string) => { const alarm = alarms.find((item) => item.id === id); if (!alarm) return null; alarm.acknowledged = true; return alarm; },
  schedules: () => schedules,
};
