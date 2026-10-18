export type PageKey =
  | 'dashboard'
  | 'plants'
  | 'smart-soil'
  | 'fertigation'
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

  fertigation: 'Uji Fertigasi',
  controls:
    'Kontrol Perangkat',

  logs:
    'Datalog',

  alarms:
    'Detail Alarm',

  devices:
    'Status Perangkat',

  settings:
    'Pengaturan',

  users:
    'Manajemen User',
}


export const pageDescriptions:
Record<
  PageKey,
  string
> = {
  dashboard:
    'Lihat kondisi tanaman, isi tandon, dan jadwal pompa.',

  plants:
    'Lihat kondisi setiap area tanam dari pembacaan sensor.',
  'smart-soil':
    'Bandingkan kondisi tanah dan udara dengan kebutuhan tanaman.',

  fertigation: 'Uji Fertigasi',
  controls:
    'Nyalakan pompa, pilih cara kerja, dan atur jadwal.',

  logs:
    'Lihat dan unduh riwayat sensor serta waktu pompa menyala dan mati.',

  alarms:
    'Lihat peringatan yang perlu diperiksa dan tindak lanjutnya.',

  devices:
    'Periksa sambungan perangkat dan waktu data terakhir diterima.',

  settings:
    'Atur nama lokasi dan pengaturan lainnya.',

  users:
    'Kelola akun dan hak akses Admin serta Operator.',
}
