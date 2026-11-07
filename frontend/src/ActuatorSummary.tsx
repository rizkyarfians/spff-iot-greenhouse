import { ToggleButtons } from './ToggleButtons'
import type { ApiActuator, ApiAutomaticControl, ApiDevice } from '@spff/contracts'
import { useRef, useState } from 'react'
import { Droplets, FlaskConical } from 'lucide-react'
import { updateActuator, resumePumpAutomation } from './api'
import './ActuatorSummary.css'

export function ActuatorSummary({ actuators, devices, connected, automatic, configuration, onUpdated, onOpenControls, onControlUpdated }: {
  actuators: ApiActuator[]
  devices: ApiDevice[]
  connected: boolean
  automatic: boolean
  configuration: ApiAutomaticControl | null
  onUpdated: (actuator: ApiActuator) => void
  onOpenControls: () => void
  onControlUpdated: (config:ApiAutomaticControl|null)=>void
}) {
  const inFlight = useRef(new Set<string>())
  const [sending, setSending] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  async function setPump(pump: ApiActuator,active:boolean) {
    if (inFlight.current.has(pump.id) || !connected
      || (active&&['pending', 'published', 'accepted'].includes(pump.commandStatus ?? ''))) return
    inFlight.current.add(pump.id)
    setSending([...inFlight.current])
    setNotice('')
    try {
      const updated = await updateActuator(pump.id, active,undefined,automatic)
      onUpdated(updated)
      if(automatic&&configuration)onControlUpdated({...configuration,operatorOverrideActive:true})
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Perintah gagal dikirim.')
    } finally {
      inFlight.current.delete(pump.id)
      setSending([...inFlight.current])
    }
  }
  return (
    <section className="actuator-summary" aria-labelledby="actuator-summary-title">
      <div className="actuator-summary-heading">
        <h2 id="actuator-summary-title">Kondisi Pompa</h2>
      </div>
      <div className="actuator-summary-items">
        {actuators.length === 0 && <p>Belum ada aktuator terdaftar.</p>}
        {actuators.map((pump) => {
          const id = pump.id
          const device = devices.find((item) => item.deviceId === pump?.deviceId)
          const available = connected && device?.connectionStatus === 'online'
          const config = configuration?.deviceId === pump.deviceId ? configuration : null
          const modeLabel = device?.mode === 'automatic' ? 'Otomatis'
            : device?.mode === 'manual' ? 'Manual' : 'Belum diketahui'
          const modeWaiting = config && (config.acknowledgedRevision !== config.revision
            || config.acknowledgementStatus === null)
          const modeRejected = config && config.acknowledgedRevision === config.revision
            && config.acknowledgementStatus === 'rejected'
          const pending = sending.includes(id) || ['pending', 'published', 'accepted'].includes(pump.commandStatus ?? '')
          const label = !available ? 'Koneksi terputus'
            : pump.state === 'fault' ? 'Bermasalah'
            : pump.state === 'offline' ? 'Belum ada laporan'
            : pending || pump.state === 'processing' ? 'Menunggu konfirmasi'
            : null
          const tone = available && pump && !pending && pump.state !== 'processing'
            ? pump.state === 'fault' ? 'fault'
              : pump.state === 'active' ? 'on' : 'neutral'
            : 'neutral'
          const Icon = id === 'pump_water' ? Droplets : FlaskConical
          const failed = !pump.commandFailureAcknowledged && ['rejected', 'failed', 'timed_out'].includes(pump?.commandStatus ?? '')
          return (
            <div className="actuator-summary-item" key={`${pump.deviceId}:${id}`}>
              <Icon size={18} aria-hidden="true" />
              <span className="actuator-summary-copy">
                <span className="actuator-summary-name">{pump.name}</span>
                <small>{available ? 'Mode' : 'Mode terakhir'}: {modeLabel}</small>
                {modeWaiting && <small>Menunggu mode {config.desiredMode === 'automatic' ? 'Otomatis' : 'Manual'}</small>}
                {modeRejected && <small>Perubahan mode ditolak alat</small>}
                {pending && <small>Menunggu konfirmasi alat</small>}
                {failed && <small>Perintah terakhir gagal</small>}
              </span>
              {label&&<span className={`actuator-summary-status is-${tone}`}>{label}</span>}
              <ToggleButtons type="button" role="switch" aria-checked={pump.isActive}
                className={`actuator-summary-switch${pump.isActive ? ' is-on' : ''}`}
                aria-label={`${pump.isActive ? 'Matikan' : 'Nyalakan'} ${pump.name}`}
                disabled={!available || sending.includes(id)}
                disabledOn={pending || pump.state==='processing' || pump.state === 'offline' || pump.state === 'fault'}
                allowOff={pending || pump.state==='processing'}
                title={automatic?'Perintah operator menjeda otomasi sampai dilanjutkan kembali.':undefined}
                onValueChange={active=>void setPump(pump,active)}><span /></ToggleButtons>
            </div>
          )
        })}
      </div>
      {automatic&&actuators.length>0&&<div className="actuator-summary-mode-hint">
        <span>{configuration?.operatorOverrideActive?'Override operator aktif. Otomasi dijeda; matikan kedua pompa sebelum melanjutkan.':'ON/OFF di sini mengambil kendali operator dan menjeda otomasi.'}</span>
        {configuration?.operatorOverrideActive?<button type="button" className="secondary-button" disabled={!connected||sending.length>0}
          onClick={()=>{if(!configuration)return;void resumePumpAutomation(configuration.deviceId).then(next=>{onControlUpdated(next);setNotice('Menunggu konfirmasi perangkat untuk melanjutkan otomasi.')}).catch(error=>setNotice(error instanceof Error?error.message:'Gagal melanjutkan otomasi.'))}}>Lanjutkan otomatis</button>
          :<button type="button" className="secondary-button" onClick={onOpenControls}>Kontrol Perangkat</button>}
      </div>}
      <div className="actuator-summary-note" role="status" aria-live="polite">{notice}</div>
    </section>
  )
}
