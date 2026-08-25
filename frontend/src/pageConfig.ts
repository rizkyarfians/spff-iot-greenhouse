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
Record<
  PageKey,
  string
> = {
  dashboard:
    'Dashboard',

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


export const pageDescriptions:
Record<
  PageKey,
  string
> = {
  dashboard:
    'Pantau kondisi fertigasi, sensor, jadwal, dan telemetry terbaru.',

  plants:
    'Pantau kondisi zona tanam berdasarkan telemetry sensor terbaru.',

  controls:
    'Kelola aktuator dan jadwal lokal berdasarkan actual state dari ESP32.',

  logs:
    'Lihat histori telemetry yang tersimpan di PostgreSQL lokal.',

  alarms:
    'Pantau alarm aktif, acknowledgement, dan status penyelesaian.',

  devices:
    'Pantau konektivitas, last seen, firmware, dan kondisi perangkat.',

  settings:
    'Kelola konfigurasi fertigasi yang tersimpan di PostgreSQL lokal.',

  users:
    'Kelola akses admin dan operator dashboard lokal SPFF.',
}
