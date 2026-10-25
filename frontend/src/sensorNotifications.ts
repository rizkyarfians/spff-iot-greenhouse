import type { ApiSensor } from '@spff/contracts'

export interface SensorNotificationDetail {
  id: string
  title: string
  description: string
  sensorKey: string
  timestamp: string
  timestampLabel: string
}

export interface SensorNotification extends SensorNotificationDetail {
  details: SensorNotificationDetail[]
}

export const sensorNotificationDelayMs = 60 * 60 * 1000

export function notificationTime(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) return 'Waktu belum tersedia'
  return `${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(time)} WIB`
}

const unavailableReasons = new Set([
  'stale_or_missing', 'jsn_stale_or_invalid', 'slave_no_hr8_hr9',
])

const reasonLabels: Record<string, string> = {
  jsn_no_echo: 'Sensor tidak memperoleh pantulan ultrasonik yang valid.',
  jsn_stale_or_invalid: 'Pembacaan ultrasonik sudah lama atau tidak valid.',
  stale_or_missing: 'Pembacaan sensor belum tersedia atau sudah kedaluwarsa.',
  crc_error: 'Data sensor gagal pemeriksaan CRC.',
  timeout: 'Sensor tidak merespons dalam batas waktu.',
  height_out_of_range: 'Pembacaan berada di luar rentang tinggi tandon.',
  slave_no_hr8_hr9: 'Diagnostik sensor tandon belum tersedia dari slave.',
}

/** One live UI entry per sensor fault; tank distance/level share a physical sensor. */
export function sensorNotifications(sensors: readonly ApiSensor[], now = Date.now()): SensorNotification[] {
  const groups = new Map<string, { name: string; reason: string; sensors: ApiSensor[] }>()
  for (const sensor of sensors) {
    // Missing optional channels are not proof of a failed installed sensor.
    if (sensor.valid !== false || sensor.faultReason === 'not_reported') continue
    const since = sensor.lastValidAt ?? sensor.invalidSince
    const time = since ? Date.parse(since) : NaN
    // Never infer a failure duration from the latest packet timestamp, null
    // values, page-open time, or a missing timestamp from an older API.
    if (!Number.isFinite(time) || now - time < sensorNotificationDelayMs) continue
    const tank = /^tank_(water|fert)_(distance_cm|level_pct)$/.exec(sensor.id)
    const source = tank ? `tank_${tank[1]}` : sensor.id
    const reason = sensor.faultReason ?? 'invalid_reading'
    const key = source
    const group = groups.get(key) ?? {
      name: tank ? `Sensor tandon ${tank[1] === 'water' ? 'air' : 'pupuk'}` : sensor.name,
      reason, sensors: [],
    }
    group.sensors.push(sensor)
    if (tank && sensor.id.endsWith('distance_cm')) group.reason = reason
    groups.set(key, group)
  }
  const details: SensorNotificationDetail[] = Array.from(groups, ([key, group]) => {
    const unavailable = unavailableReasons.has(group.reason)
    return {
      id: `sensor-fault:${key}`,
      title: unavailable
        ? `${group.name}: data belum tersedia / terlambat`
        : group.reason === 'invalid_reading'
          ? `${group.name}: pembacaan tidak valid`
          : `${group.name} gagal membaca`,
      description: `${reasonLabels[group.reason] ?? 'Perangkat melaporkan pembacaan sensor tidak valid.'} Kode: ${group.reason}. ${unavailable ? 'Status ini belum membuktikan sensor rusak.' : 'Nilai lama tidak dianggap pembacaan baru.'}`,
      sensorKey: group.sensors.find(sensor => sensor.id.endsWith('level_pct'))?.id ?? group.sensors[0]!.id,
      timestamp: group.sensors[0]!.lastValidAt ?? group.sensors[0]!.invalidSince!,
      timestampLabel: group.sensors[0]!.lastValidAt ? 'Data valid terakhir' : 'Mulai terpantau tanpa data valid',
    }
  })
  if (!details.length) return []
  if (details.length === 1) return [{ ...details[0]!, details }]
  const oldest = [...details].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0]!
  return [{
    id: `sensor-fault:summary:${details.map(item => item.id).sort().join('|')}`, title: `${details.length} sensor belum mendapat pembacaan valid`,
    description: 'Sudah minimal 1 jam tanpa laporan pembacaan valid. Buka rincian untuk melihat sensor dan alasannya.',
    sensorKey: oldest.sensorKey, timestamp: oldest.timestamp,
    timestampLabel: 'Data valid terakhir / awal pemantauan terlama', details,
  }]
}
