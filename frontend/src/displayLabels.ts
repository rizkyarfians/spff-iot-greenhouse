const reasonLabels: Record<string, string> = {
  water_tank_interlock:'Proteksi tandon air aktif',
  pulse_outcome_unknown:'Hasil pemberian belum terkonfirmasi',
  server_pulse_owner:'Pompa sedang digunakan sesi AI',
  calibration_missing:'Kalibrasi belum tersedia',
  automatic_water: 'Kontrol otomatis pompa air',
  automatic_fertilizer: 'Kontrol otomatis pompa pupuk',
  automatic_config_change: 'Pengaturan otomatis diperbarui',
  automatic_ota_interlock: 'Alat sedang diperbarui',
  automatic_mode_exit: 'Beralih ke cara manual',
  device_schedule: 'Jadwal penyiraman',
  relay_fault: 'Saklar pompa bermasalah',
  command_expired: 'Batas waktu perintah habis',
  automatic_mode: 'Sedang memakai cara otomatis',
  safety_interlock: 'Dihentikan demi keamanan',
  tank_level_ignored: 'Pengukuran isi tandon belum digunakan',
  invalid_config: 'Pengaturan belum lengkap',
  invalid_water_config: 'Pengaturan pompa air belum lengkap',
  invalid_fertilizer_config: 'Pengaturan pompa pupuk belum lengkap',
  invalid_mode: 'Pilihan cara kerja tidak dikenali',
  invalid_generated_at: 'Waktu pengaturan tidak sesuai',
  stale_revision: 'Pengaturan lama diabaikan',
  revision_conflict: 'Pengaturan bertabrakan',
  nvs_write_failed: 'Pengaturan gagal disimpan pada alat',
}

export const farmerReasonLabel = (
  reason: string | null | undefined,
) => {
  if (!reason) return ''
  return reasonLabels[reason]
    ?? 'Periksa kondisi alat sebelum mencoba kembali.'
}
