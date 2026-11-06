import { useEffect, useState } from 'react'
import type { ApiSensorDefinition } from '@spff/contracts'
import { saveSensorEnabled } from './api'

function SensorSwitch({ sensor, editable, onRefresh }: {
  sensor: ApiSensorDefinition
  editable: boolean
  onRefresh: () => void
}) {
  const [enabled, setEnabled] = useState(sensor.enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setEnabled(sensor.enabled), [sensor.enabled])

  async function toggle() {
    setSaving(true)
    setError('')
    try {
      const saved = await saveSensorEnabled(sensor.sensorKey, !enabled)
      setEnabled(saved.enabled)
      onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengaturan sensor gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  return <div>
    <button type="button" role="switch" aria-label={sensor.displayName}
      aria-checked={enabled} disabled={!editable || saving}
      className={`sensor-enable-card${enabled ? ' is-enabled' : ''}`} onClick={() => void toggle()}>
      <span><strong>{sensor.displayName}</strong>
        <small>{saving ? 'Menyimpan…' : enabled ? 'Aktif' : 'Nonaktif'}</small></span>
      <span className="sensor-enable-switch" aria-hidden="true"><span /></span>
    </button>
    {error && <p role="alert">{error}</p>}
  </div>
}

export function SensorSettings({ sensors, editable, onRefresh }: {
  sensors: ApiSensorDefinition[]
  editable: boolean
  onRefresh: () => void
}) {
  return <section className="page-card" aria-label="Pengaturan sensor">
    <h2>Sensor Dashboard</h2>
    <p>Atur sensor yang tampil di dashboard dan pilihan data. Perubahan tersimpan saat switch ditekan.</p>
    {sensors.filter(sensor => !sensor.sensorKey.startsWith('soil_1_')).map(sensor =>
      <SensorSwitch key={sensor.sensorKey} sensor={sensor} editable={editable} onRefresh={onRefresh} />)}
  </section>
}
