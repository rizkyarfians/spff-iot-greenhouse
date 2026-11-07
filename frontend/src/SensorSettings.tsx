import { useEffect, useState } from 'react'
import type { ApiSensorDefinition } from '@spff/contracts'
import { saveSensorEnabled } from './api'
import { dashboardSensorGroup, type DashboardSensorGroup } from './dashboardSensors'
import { SettingChoice } from './SettingChoice'

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

  async function toggle(next:boolean) {
    setSaving(true)
    setError('')
    try {
      const saved = await saveSensorEnabled(group, next)
      setCurrent(saved.enabled ? 'on' : 'off')
      onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengaturan sensor gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="sw-sensor-item">
    <div className="sw-setting-row">
      <span><strong>{label}</strong>
        <small>{saving ? 'Menyimpan…' : current === 'mixed' ? 'Sebagian parameter aktif' : enabled ? 'Ditampilkan di dashboard' : 'Disembunyikan dari dashboard'}</small></span>
      <SettingChoice label={`Sensor ${label}`} value={current==='mixed'?null:enabled}
        disabled={!editable||saving} onChange={next=>void toggle(next)}/>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>
}

export function SensorSettings({ sensors, editable, onRefresh }: {
  sensors: ApiSensorDefinition[]
  editable: boolean
  onRefresh: () => void
}) {
  return <section className="page-card" aria-label="Pengaturan sensor">
    <header className="sw-section-heading"><h2>Sensor dashboard</h2>
    <p>Pilih kelompok sensor yang ingin ditampilkan.</p></header>
    {groups.map(({ key, label }) => {
      const members = sensors.filter(sensor => dashboardSensorGroup(sensor.sensorKey) === key)
      const active = members.filter(sensor => sensor.enabled).length
      const state = active === 0 ? 'off' : active === members.length ? 'on' : 'mixed'
      return <SensorSwitch key={key} group={key} label={label} state={state}
        editable={editable && members.length > 0} onRefresh={onRefresh} />
    })}
    <p className="sw-save-hint">Perubahan sensor langsung tersimpan.</p>
  </section>
}
