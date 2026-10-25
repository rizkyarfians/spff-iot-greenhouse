import type { ApiSensor } from '@spff/contracts'

export interface SensorNotification {
  id: string
  title: string
  description: string
  sensorKey: string
}

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
export function sensorNotifications(sensors: readonly ApiSensor[]): SensorNotification[] {
  const groups = new Map<string, { name: string; reason: string; sensors: ApiSensor[] }>()
  for (const sensor of sensors) {
    // Missing optional channels are not proof of a failed installed sensor.
    if (sensor.valid !== false || sensor.faultReason === 'not_reported') continue
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
  return Array.from(groups, ([key, group]) => ({
    id: `sensor-fault:${key}`,
    title: `${group.name} gagal membaca`,
    description: `${reasonLabels[group.reason] ?? 'Perangkat melaporkan pembacaan sensor tidak valid.'} Kode: ${group.reason}. Angka terakhir bukan pembacaan baru.`,
    sensorKey: group.sensors.find(sensor => sensor.id.endsWith('level_pct'))?.id ?? group.sensors[0]!.id,
  }))
}
