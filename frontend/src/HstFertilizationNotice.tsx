import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Droplets, FlaskConical, History, Pause, Power } from 'lucide-react'
import type { AutomaticCycleStatus } from '@spff/contracts'
import { fetchHstFertilizationStarts, fetchAutomaticCycleStatus } from './api'
import './HstFertilizationNotice.css'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
function Quantity({ value }: { value: number | null }) {
  return <strong className="hfp-value">{value === null ? '—' : number.format(value)}{value !== null && <span>g</span>}</strong>
}

export function HstPhaseCard({ cycle }: { cycle: AutomaticCycleStatus }) {
  const phase = cycle.phase
  const recorded = phase?.history?.recordedG ?? phase?.deliveredG ?? 0
  const remaining = phase?.history?.remainingG ?? phase?.remainingG ?? phase?.targetG ?? null
  const percent = phase?.targetG && phase.targetG > 0 ? Math.max(0, Math.min(100, recorded / phase.targetG * 100)) : null
  const watering = cycle.mode === 'watering'
  const Icon = watering ? Droplets : FlaskConical
  const title = cycle.mode === 'waiting_off' ? 'Target pemupukan tercapai' : watering ? 'Penyiraman Fuzzy' : phase?.title ?? 'Program otomatis'
  const historyText = phase?.history?.status === 'unmeasured' ? 'Sesi tercatat · perhitungan belum lengkap' :
    phase?.history?.lastRecordedAt ? 'Catatan ' + new Date(phase.history.lastRecordedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' :
    recorded > 0 ? 'Berdasarkan riwayat tersimpan' : 'Belum ada pengiriman tercatat'
  return <article className={'hfp-card' + (watering ? ' hfp-card--water' : '')} aria-label="Fase pemupukan dan penyiraman">
    <header className="hfp-header">
      <div className="hfp-heading">
        <span className="hfp-icon"><Icon size={23} strokeWidth={1.7} aria-hidden="true" /></span>
        <div><div className="hfp-eyebrow">{phase ? 'Fase ' + phase.phaseNumber : 'Kontrol otomatis'}<span />{phase ? 'HST ' + phase.hst : 'Tanaman'}</div>
          <h3>{title}</h3><p>{phase ? phase.product + ' · ' + phase.method : 'Status program tanaman'}</p></div>
      </div>
      <span className={'hfp-badge ' + (cycle.dispatchEnabled ? 'hfp-badge--on' : 'hfp-badge--off')}>
        <Power size={13} aria-hidden="true" /> Otomasi {cycle.dispatchEnabled ? 'ON' : 'OFF'}
      </span>
    </header>
    {phase ? <>
      <div className="hfp-metrics">
        <div className="hfp-metric"><span>Target fase</span><Quantity value={phase.targetG} /></div>
        <div className="hfp-metric"><span>{phase.estimated ? 'Tercatat · estimasi EC' : 'Tercatat diberikan'}</span><Quantity value={recorded} /></div>
        <div className="hfp-metric hfp-metric--remaining"><span>Sisa target tercatat</span><Quantity value={remaining} /></div>
      </div>
      <div className="hfp-progress-heading"><span>Progres pemupukan</span><strong>{percent === null ? '—' : number.format(percent) + '%'}</strong></div>
      <progress className="hfp-progress" value={percent ?? 0} max={100} aria-label="Progres pemupukan berdasarkan gram tercatat" />
      <p className={'hfp-history' + (phase.history?.status === 'unmeasured' ? ' hfp-history--pending' : '')}>
        <History size={14} aria-hidden="true" />{historyText}
      </p>
    </> : <p className="hfp-empty">Belum ada fase pemupukan yang tercatat.</p>}
    <footer className="hfp-footer">
      <span className="hfp-water-state">{watering ? <Droplets size={15} aria-hidden="true" /> : cycle.mode === 'waiting_off' ? <Clock3 size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        {watering ? 'Fuzzy air tersedia' : cycle.mode === 'fertilization' ? 'Fuzzy air dijeda selama pemupukan' : cycle.mode === 'waiting_off' ? 'Menunggu konfirmasi pompa OFF' : 'Menunggu status program'}</span>
      {cycle.nextHst !== null && <span className="hfp-next">Berikutnya <b>HST {cycle.nextHst}</b></span>}
    </footer>
    {phase && <details className="hfp-details"><summary>Detail perhitungan<ChevronDown size={14} aria-hidden="true" /></summary>
      <div>
        {phase.history?.status === 'empty' && <p>Angka menunjukkan riwayat yang sudah tercatat untuk fase ini.</p>}
        {phase.gPerPlant != null && <p>Rata-rata: <b>{phase.gPerPlant.toLocaleString('id-ID', { maximumFractionDigits: 5 })} g/tanaman</b></p>}
        {phase.coefficient != null && <p>K: <b>{phase.coefficient}</b> · Baseline EC: <b>{phase.baselineEcUs} µS/cm</b></p>}
        {phase.estimationReason === 'coefficient_missing' && <p>Isi koefisien K di Pengaturan untuk menghitung riwayat formulasi ini.</p>}
        {phase.estimationReason === 'baseline_unavailable' && phase.history?.status === 'unmeasured' && <p>Baseline EC air untuk sesi ini belum ditemukan di riwayat.</p>}
        {phase.estimationReason === 'estimate_only' && <p>Estimasi eksperimen; kalibrasi belum diverifikasi untuk progres fase.</p>}
        {phase.estimationReason === 'calibration_changed' && <p>Koefisien fase berbeda dari kalibrasi terbaru. Periksa Pengaturan EC.</p>}
        {!!phase.unmeasuredIntervals && <p>{phase.unmeasuredIntervals} interval belum terukur dan tidak ditambahkan ke estimasi.</p>}
        {!cycle.dispatchEnabled && <p>Otomasi server belum diaktifkan. Riwayat tetap dapat dilihat.</p>}
      </div>
    </details>}
  </article>
}

export function HstFertilizationNotice({ deviceId }: { deviceId: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchHstFertilizationStarts>>>([])
  const [error, setError] = useState('')
  const [cycle, setCycle] = useState<AutomaticCycleStatus | null>(null)
  useEffect(() => {
    setRows([]); setCycle(null); setError('')
    if (!deviceId) return
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const [next, status] = await Promise.all([fetchHstFertilizationStarts(deviceId, controller.signal), fetchAutomaticCycleStatus(deviceId, controller.signal)])
        if (!controller.signal.aborted) { setRows(next); setCycle(status); setError('') }
      } catch {
        if (!controller.signal.aborted) setError('Status pemupukan belum tersedia.')
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [deviceId])
  return <section className="hfp-notice" aria-label="Ringkasan pemupukan HST">
    {error && <p className="hfp-error" role="status"><AlertCircle size={16} aria-hidden="true" />{error}{cycle ? ' Riwayat terakhir tetap ditampilkan.' : ''}</p>}
    {cycle && <HstPhaseCard cycle={cycle} />}
    {rows.length > 0 && <details className="hfp-sessions"><summary><History size={15} aria-hidden="true" />Riwayat sesi hari ini<span>{rows.length}</span><ChevronDown className="hfp-chevron" size={15} aria-hidden="true" /></summary>
      <div>{rows.map(row => {
        const EventIcon = row.status === 'started' ? CheckCircle2 : row.status === 'queued' ? Clock3 : AlertCircle
        return <article className={'hfp-session hfp-session--' + row.status} key={row.start_id}>
          <EventIcon size={18} aria-hidden="true" /><div><strong>{row.status === 'started' ? 'Pemupukan dimulai' : row.status === 'queued' ? 'Perintah terkirim' : 'Sesi perlu diperiksa'}</strong>
            <p>HST {row.hst} · {row.product}</p><small>{row.status === 'started' ? 'Perangkat mengonfirmasi kedua pompa ON pada sesi ini.' : row.status === 'queued' ? 'Menunggu konfirmasi perangkat.' : 'Periksa status pompa di Kontrol Perangkat.'}</small></div>
        </article>
      })}</div>
    </details>}
  </section>
}
