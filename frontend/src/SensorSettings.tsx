import { useEffect, useState } from 'react'
import type { ApiSensorDefinition } from '@spff/contracts'
import { saveSensorEnabled } from './api'
import { dashboardSensorGroup, type DashboardSensorGroup } from './dashboardSensors'

const groups: { key: DashboardSensorGroup; label: string }[] = [
  { key: 'soil1', label: 'Tanah 1' }, { key: 'soil2', label: 'Tanah 2' },
  { key: 'water', label: 'Air' }, { key: 'environment', label: 'Lingkungan' },
  { key: 'energy', label: 'Energi' },
]

function SensorSwitch({ group, label, state, editable, onRefresh }: {
  group: DashboardSensorGroup
  label: string
  state: 'on' | 'off' | 'mixed'
  editable: boolean
  onRefresh: () => void
}) {
  const [current, setCurrent] = useState(state)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setCurrent(state), [state])
  const enabled = current === 'on'

  async function toggle() {
    setSaving(true)
    setError('')
    try {
      const saved = await saveSensorEnabled(group, !enabled)
      setCurrent(saved.enabled ? 'on' : 'off')
      onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengaturan sensor gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  return <div>
    <button type="button" role="switch" aria-label={label}
      aria-checked={enabled} disabled={!editable || saving}
      className={`sensor-enable-card${enabled ? ' is-enabled' : ''}`} onClick={() => void toggle()}>
      <span><strong>{label}</strong>
        <small>{saving ? 'Menyimpan…' : current === 'mixed' ? 'Sebagian aktif' : enabled ? 'Aktif' : 'Nonaktif'}</small></span>
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
    <p>Atur tampilan sensor per kelompok. Perubahan tersimpan saat switch ditekan.</p>
    {groups.map(({ key, label }) => {
      const members = sensors.filter(sensor => dashboardSensorGroup(sensor.sensorKey) === key)
      const active = members.filter(sensor => sensor.enabled).length
      const state = active === 0 ? 'off' : active === members.length ? 'on' : 'mixed'
      return <SensorSwitch key={key} group={key} label={label} state={state}
        editable={editable && members.length > 0} onRefresh={onRefresh} />
    })}
  </section>
}
