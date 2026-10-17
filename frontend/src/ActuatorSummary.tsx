import type { ApiActuator, ApiDevice } from '@spff/contracts'
import { ArrowUpRight, Droplets, FlaskConical } from 'lucide-react'
import './ActuatorSummary.css'

export function ActuatorSummary({ actuators, devices, connected, onOpen }: {
  actuators: ApiActuator[]
  devices: ApiDevice[]
  connected: boolean
  onOpen: () => void
}) {
  return (
    <section className="actuator-summary" aria-labelledby="actuator-summary-title">
      <div className="actuator-summary-heading">
        <h2 id="actuator-summary-title">Kondisi Pompa</h2>
      </div>
      <div className="actuator-summary-items">
        {(['pump_water', 'pump_fert'] as const).map((id) => {
          const pump = actuators.find((item) => item.id === id)
          const device = devices.find((item) => item.deviceId === pump?.deviceId)
          const available = connected && device?.connectionStatus === 'online'
          const pending = ['pending', 'published', 'accepted'].includes(pump?.commandStatus ?? '')
          const label = !pump ? 'Belum ada data'
            : !available ? 'Koneksi terputus'
            : pump.state === 'fault' ? 'Bermasalah'
            : pump.state === 'offline' ? 'Belum ada laporan'
            : pending || pump.state === 'processing' ? 'Menunggu konfirmasi'
            : pump.isActive ? 'Menyala' : 'Mati'
          const tone = available && pump && !pending && pump.state !== 'processing'
            ? pump.state === 'fault' ? 'fault'
              : pump.state === 'active' ? 'on' : 'neutral'
            : 'neutral'
          const Icon = id === 'pump_water' ? Droplets : FlaskConical
          const failed = ['rejected', 'failed', 'timed_out'].includes(pump?.commandStatus ?? '')
          return (
            <button className="actuator-summary-item" key={id} type="button" onClick={onOpen}
              aria-label={`Buka kontrol ${id === 'pump_water' ? 'pompa air' : 'pompa pupuk'}: ${label}`}>
              <Icon size={18} aria-hidden="true" />
              <span className="actuator-summary-copy">
                <span className="actuator-summary-name">{id === 'pump_water' ? 'Pompa Air' : 'Pompa Pupuk'}</span>
                {pending && <small>Permintaan: {pump?.requestedIsActive ? 'nyalakan' : 'matikan'} pompa</small>}
                {failed && <small>Perintah terakhir gagal</small>}
              </span>
                <span className={`actuator-summary-status is-${tone}`}>{label}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
