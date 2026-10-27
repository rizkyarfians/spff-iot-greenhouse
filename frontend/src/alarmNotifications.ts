import type { ApiAlarm } from '@spff/contracts'

const reasons: Record<string,string> = {
 calibration_missing:'Kalibrasi AI belum disimpan. Isi dan verifikasi kalibrasi di Program Fertigasi.',
 schedule_start_unconfirmed:'Jadwal sudah aktif lebih dari 30 detik, tetapi belum ada konfirmasi pompa ON. Periksa interlock, mode, dan relay.',
 water_tank_interlock:'Interlock tandon air sedang aktif.', pulse_local_interlock:'Pengaman lokal menghentikan pulse; periksa tandon, aliran, dan sensor.',
 pulse_not_ready:'Perangkat belum siap menerima pulse.', pulse_outcome_unknown:'Konfirmasi hasil pulse belum diterima; kondisi pompa belum dapat dipastikan.',
 tank_sensor_or_level_invalid:'Pembacaan tandon tidak valid atau level belum memenuhi batas minimum.',
 soil_sensor_invalid_or_stale:'Data sensor tanah tidak valid atau sudah kedaluwarsa.',
 moisture_outside_calibrated_range:'Kelembapan tanah di luar rentang kalibrasi.',
 pulse_budget_limit:'Batas durasi atau jumlah pulse telah tercapai.',
 pulse_relay_fault:'Perangkat melaporkan kegagalan relay.', relay_fault:'Perangkat melaporkan kegagalan relay.',
 pulse_storage_fault:'Penyimpanan status pulse pada perangkat bermasalah.',
 pulse_boot_changed:'Perangkat restart; identitas boot sudah berubah.',
 command_expired:'Perintah kedaluwarsa sebelum dijalankan.', timed_out:'Perangkat tidak memberi konfirmasi dalam batas waktu.',
 command_timed_out:'Perangkat tidak memberi konfirmasi dalam batas waktu.',
 server_pulse_owner:'Pompa sedang dimiliki pengendali pulse AI.',
 rule_mode_schedule_or_device_changed:'Aturan, mode, atau kesiapan perangkat berubah saat sesi berjalan.',
 disabled_or_session_timeout:'Eksekusi dinonaktifkan atau batas waktu sesi tercapai.',
}

export function alarmNotification(alarm:ApiAlarm) {
 const pump=alarm.sourceKey==='pump_water'?'Pompa air':alarm.sourceKey==='pump_fert'?'Pompa pupuk':null
 const meta=alarm.metadata
 const reason=typeof meta?.reason==='string'?meta.reason:null
 const ai=meta?.source==='soil-ec'
 const failed=pump && (alarm.ruleKey==='command_failed'||alarm.ruleKey==='actuator_fault')
 const title=failed?(meta?.source==='schedule'?`Jadwal ${pump.toLowerCase()}: belum ada konfirmasi ON`:ai?`${pump}: eksekusi AI tertahan / bermasalah`:meta?.requestedIsActive===true?`${pump} gagal menyala`:`Perintah ${pump.toLowerCase()} bermasalah`):alarm.title
 const explanation=reason?(reasons[reason]??reason):null
 return {
  // New command/session/reason becomes unread; identical repeated observations stay read.
  id:`alarm:${alarm.id}:${String(meta?.commandId??meta?.sessionId??'incident')}:${reason??''}`,
  title,description:failed?`${explanation??alarm.description} Perangkat: ${alarm.deviceId}.`:alarm.description,
  kind:'alarm' as const,sensorKey:'',timestamp:alarm.lastSeenAt??alarm.triggeredAt??alarm.createdAt,
  timestampLabel:'Waktu kejadian',details:[],
 }
}

export const notificationBadgeText=(count:number)=>count>99?'99+':String(count)
