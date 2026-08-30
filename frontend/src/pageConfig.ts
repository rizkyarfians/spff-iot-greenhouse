export type PageKey =
  | 'dashboard'
  | 'plants'
  | 'smart-soil'
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
  'smart-soil':
    'Smart Soil',

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
    'Pantau kondisi fertigasi, sensor, jadwal, dan data terbaru.',

  plants:
    'Pantau kondisi zona tanam berdasarkan data sensor terbaru.',
  'smart-soil':
    'Pantau kondisi udara dan tanah, lalu lihat rekomendasi tanaman.',

  controls:
    'Nyalakan pompa, pilih cara kerja, dan atur jadwal.',

  logs:
    'Lihat histori data sensor dan aktivitas pompa yang tersimpan di sistem lokal.',

  alarms:
    'Lihat peringatan yang perlu diperiksa dan tindak lanjutnya.',

  devices:
    'Pantau konektivitas, last seen, firmware, dan kondisi perangkat.',

  settings:
    'Kelola konfigurasi fertigasi yang tersimpan di sistem lokal.',

  users:
    'Kelola akses admin dan operator dashboard lokal SPFF.',
}
