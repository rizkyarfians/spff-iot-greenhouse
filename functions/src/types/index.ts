export type SensorType = 'ph' | 'ec' | 'temperature' | 'soilMoisture' | 'waterTank' | 'nutrientTank';
export type HealthStatus = 'good' | 'warning' | 'critical' | 'offline';
export type PumpState = 'active' | 'inactive' | 'processing' | 'offline' | 'fault';
export type Severity = 'info' | 'warning' | 'critical';
export interface Weather { location: string; temperature: number; condition: string; date: string }
export interface Sensor { id: string; type: SensorType; name: string; value: number; unit: string; status: HealthStatus; updatedAt: string }
export interface HistoryPoint { time: string; value: number }
export interface Pump { id: string; name: string; isActive: boolean; state: PumpState; activeDuration: string; updatedAt: string }
export interface Alarm { id: string; title: string; description: string; severity: Severity; acknowledged: boolean; createdAt: string }
export interface Schedule { id: string; name: string; scheduledAt: string; zone: string; status: 'today' | 'upcoming' }
