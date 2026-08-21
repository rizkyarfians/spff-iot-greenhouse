export type PageKey =
  | 'dashboard'
  | 'plants'
  | 'controls'
  | 'logs'
  | 'alarms'
  | 'devices'
  | 'settings'
  | 'users'


export const pageTitles:
Record<PageKey, string> = {
  dashboard:
    'Monitoring Sensor',

  plants:
    'Status Tanaman',

  controls:
    'Kontrol Perangkat',

  logs:
    'Datalog Sensor',

  alarms:
    'Detail Alarm',

  devices:
    'Status Perangkat',

  settings:
    'Pengaturan Sistem',

  users:
    'Manajemen User',
}