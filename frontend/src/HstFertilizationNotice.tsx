import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Droplets, FlaskConical, History, Pause, Power, X } from 'lucide-react'
import type { AutomaticCycleStatus } from '@spff/contracts'
import { fetchAiHstLiquidSummary, fetchHstFertilizationStarts, fetchAutomaticCycleStatus } from './api'
import { fuzzyIrrigationEstimate } from './hstIrrigationSummary'
import './HstFertilizationNotice.css'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const doseNumber = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 5 })
function Quantity({ value, unit = 'g' }: { value: number | null; unit?: string }) {
  return <strong className="hfp-value">{value === null ? '—' : (unit === 'g/tanaman' ? doseNumber : number).format(value)}{value !== null && <span>{unit}</span>}</strong>
}

function DashboardFuzzyEstimate() {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof fetchAiHstLiquidSummary>> | null | undefined>()
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const result = await fetchAiHstLiquidSummary(controller.signal)
        if (!controller.signal.aborted) setSummary(result)
      } catch {
        if (!controller.signal.aborted) setSummary(null)
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])

  const estimate = fuzzyIrrigationEstimate(summary ?? null)
  if (!estimate) return <p className="hfp-progress-caption" role="status">
    {summary === undefined ? 'Memuat estimasi kebutuhan air…' : 'Estimasi kebutuhan air terbaru belum tersedia.'}
  </p>

  return <div className="hfp-metrics">
    <div className="hfp-metric">
      <span>{estimate.label}</span>
      <Quantity value={estimate.valueL} unit="L" />
      <span>{estimate.source}</span>
    </div>
    {estimate.inputKey && estimate.moisturePct != null && <div className="hfp-metric">
      <span>Kelembapan Tanah {estimate.inputKey === 'soil_1_moisture' ? '1' : '2'}</span>
      <Quantity value={estimate.moisturePct} unit="%" />
    </div>}
  </div>
}

export function HstPhaseCard({ cycle, compact = false }: { cycle: AutomaticCycleStatus; compact?: boolean }) {
  const [closed, setClosed] = useState(false)
  const watering = cycle.mode === 'watering'
  const showFuzzyEstimate = compact && watering
  const phase = showFuzzyEstimate ? null : cycle.phase
  const recorded = phase?.history?.recordedG ?? phase?.deliveredG ?? 0
  const remaining = phase?.history?.remainingG ?? phase?.remainingG ?? phase?.targetG ?? null
  const plants = phase?.plantCount ?? (phase?.targetG != null && phase.targetGPerPlant != null && phase.targetGPerPlant > 0
    ? phase.targetG / phase.targetGPerPlant : null)
  const recordedPerPlant = plants != null && plants > 0 ? recorded / plants : null
  const remainingPerPlant = plants != null && plants > 0 && remaining != null ? remaining / plants : null
  const percent = phase?.targetG && phase.targetG > 0 ? Math.max(0, Math.min(100, recorded / phase.targetG * 100)) : null
  const Icon = watering ? Droplets : FlaskConical
  const title = cycle.mode === 'waiting_off' ? 'Target pemupukan tercapai' : watering ? 'Penyiraman Fuzzy' : phase?.title ?? 'Program otomatis'
  const waitingText = phase?.estimationReason === 'coefficient_missing' ? 'Menunggu koefisien K' :
    phase?.estimationReason === 'baseline_unavailable' ? 'EC sebelum injeksi belum ditemukan di riwayat' :
    phase?.intervalReason === 'pump_status_unconfirmed' ? 'Menunggu status pompa yang sesuai waktu sensor' :
    phase?.intervalReason === 'ec_or_flow_invalid' ? 'Pembacaan EC atau flow belum valid' :
    phase?.intervalReason === 'injection_flow_unconfirmed' ? 'Aliran injeksi pupuk belum terukur' :
    'Menunggu interval EC dan flow yang valid'
  const historyText = phase?.history?.status === 'unmeasured' ? waitingText :
    phase?.history?.lastRecordedAt ? 'Catatan ' + new Date(phase.history.lastRecordedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' :
    recorded > 0 ? 'Berdasarkan riwayat tersimpan' : 'Belum ada pengiriman tercatat'
  const doseDetails = phase && <>
    <div className="hfp-metrics">
      <div className="hfp-metric"><span>Dosis per tanaman</span><Quantity value={phase.targetGPerPlant ?? null} unit="g/tanaman" /></div>
      <div className="hfp-metric"><span>{phase.baselineBasis==='PRE_INJECTION_SENSOR' ? 'Estimasi per tanaman · EC sebelum ON' : phase.estimated ? 'Estimasi tercatat per tanaman' : 'Tercatat per tanaman'}</span><Quantity value={recordedPerPlant} unit="g/tanaman" /></div>
      <div className="hfp-metric hfp-metric--remaining"><span>Sisa per tanaman</span><Quantity value={remainingPerPlant} unit="g/tanaman" /></div>
    </div>
    <p className={'hfp-history' + (phase.history?.status === 'unmeasured' ? ' hfp-history--pending' : '')}>
      <History size={14} aria-hidden="true" />{historyText}
    </p>
  </>
  if (closed) return <button type="button" className="hfp-reopen" onClick={() => setClosed(false)} aria-expanded={false}>
    <Icon size={17} aria-hidden="true" />Tampilkan fase pemupukan & penyiraman<ChevronDown size={15} aria-hidden="true" />
  </button>
  return <article className={'hfp-card hfp-card--impact' + (watering ? ' hfp-card--water' : '')} aria-label="Fase pemupukan dan penyiraman">
    <header className="hfp-header">
      <div className="hfp-heading">
        <span className="hfp-icon"><Icon size={23} strokeWidth={1.7} aria-hidden="true" /></span>
        <div><div className="hfp-eyebrow">{phase ? 'Fase ' + phase.phaseNumber : 'Kontrol otomatis'}<span />{phase ? 'HST ' + phase.hst : 'Tanaman'}</div>
          <h3>{title}</h3><p>{phase ? phase.product + ' · ' + phase.method : showFuzzyEstimate ? 'Berdasarkan kelembapan tanah' : 'Status program tanaman'}</p></div>
      </div>
      <div className="hfp-header-actions"><span className={'hfp-badge ' + (cycle.dispatchEnabled ? 'hfp-badge--on' : 'hfp-badge--off')}>
        <Power size={13} aria-hidden="true" /> Otomasi {cycle.dispatchEnabled ? 'ON' : 'OFF'}
      </span><button type="button" className="hfp-close" aria-label="Tutup kartu fase pemupukan dan penyiraman" title="Tutup kartu" onClick={() => setClosed(true)}><X size={18} aria-hidden="true" /></button></div>
    </header>
    {showFuzzyEstimate ? <DashboardFuzzyEstimate key={cycle.deviceId} /> : <div className="hfp-impact-progress">
      <div className="hfp-progress-heading"><span>{phase?'Progres pemupukan':'Progres program'}</span></div>
      <div className="hfp-progress-track">
        {percent===null?<div className="hfp-track-placeholder" aria-hidden="true"/>:
          <progress className="hfp-progress" value={percent} max={100} aria-label="Progres pemupukan berdasarkan gram tercatat"/>}
        <span className="hfp-progress-chip" style={{left:`clamp(26px, ${percent??0}%, calc(100% - 26px))`}}>{percent===null?'—':number.format(percent)+'%'}</span>
      </div>
      <p className="hfp-progress-caption">{phase
        ? percent===null?'Target fase belum tersedia':number.format(recorded)+' g dari '+number.format(phase.targetG!)+' g target fase'
        : watering?'Status penyiraman mengikuti data perangkat.':'Belum ada fase pemupukan yang tercatat.'}</p>
    </div>}
    {compact && cycle.mode === 'waiting_off' && <p className="hfp-progress-caption">Menunggu konfirmasi pompa OFF.</p>}
    {compact && phase && <details className="hfp-details hfp-dose-details">
      <summary>Detail<ChevronDown size={14} aria-hidden="true" /></summary>
      {doseDetails}
    </details>}
    {!compact && (phase ? doseDetails : <div className="hfp-impact-waiting">
      <div><Clock3 size={18} aria-hidden="true"/><span><strong>{cycle.nextHst==null?'Belum tersedia':'HST '+cycle.nextHst}</strong><small>Fase berikutnya</small></span></div>
      <div><Icon size={18} aria-hidden="true"/><span><strong>{watering?'Penyiraman':'Menunggu fase'}</strong><small>Status program</small></span></div>
    </div>)}
    {!compact && <footer className="hfp-footer">
      <span className="hfp-water-state">{watering ? <Droplets size={15} aria-hidden="true" /> : cycle.mode === 'waiting_off' ? <Clock3 size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        {watering ? 'Fuzzy air tersedia' : cycle.mode === 'fertilization' ? 'Fuzzy air dijeda selama pemupukan' : cycle.mode === 'waiting_off' ? 'Menunggu konfirmasi pompa OFF' : 'Menunggu status program'}</span>
      {cycle.nextHst !== null && <span className="hfp-next">Berikutnya <b>HST {cycle.nextHst}</b></span>}
    </footer>}
    {!compact && phase && <details className="hfp-details"><summary>Detail perhitungan<ChevronDown size={14} aria-hidden="true" /></summary>
      <div>
        <p>Gram interval = max(EC campuran − EC awal, 0) ÷ K × volume campuran.</p>
        <p>Total fase: target <b>{phase.targetG == null ? '—' : number.format(phase.targetG)} g</b> · tercatat <b>{number.format(recorded)} g</b> · sisa <b>{remaining == null ? '—' : number.format(remaining)} g</b>.</p>
        {plants != null && plants > 0 && <p>Dosis rata-rata: {number.format(recorded)} g ÷ {number.format(plants)} tanaman = <b>{doseNumber.format(recordedPerPlant!)} g/tanaman</b>.</p>}
        {phase.history?.status === 'empty' && <p>Angka menunjukkan riwayat yang sudah tercatat untuk fase ini.</p>}
        {phase.coefficient != null && <p>K: <b>{number.format(phase.coefficient)}</b> · EC awal: <b>{phase.baselineEcUs == null ? '—' : number.format(phase.baselineEcUs) + ' µS/cm'}</b></p>}
        {phase.baselineAt && <p>EC awal dari sensor: {new Date(phase.baselineAt).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'})} WIB
          {phase.baselineBasis==='PRE_INJECTION_SENSOR'?' · sebelum pompa ON':' · air mengalir, pupuk OFF'}</p>}
        {phase.lastCalculation && phase.baselineEcUs != null && phase.coefficient != null && <div className="hfp-calculation">
          <span>Interval terakhir · {new Date(phase.lastCalculation.at).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'})} WIB</span>
          <strong>max({number.format(phase.lastCalculation.ecUsCm)} − {number.format(phase.baselineEcUs)}, 0) ÷ {number.format(phase.coefficient)} × {number.format(phase.lastCalculation.volumeL)} L = {number.format(phase.lastCalculation.massG)} g</strong>
          <small>Total tercatat menjumlahkan interval yang valid, bukan debit sesaat.</small>
        </div>}
        {phase.baselineBasis==='PRE_INJECTION_SENSOR' && <p>Memakai EC sensor sebelum ON sebagai referensi estimasi. EC air saat mengalir diperlukan untuk memastikan fase terpenuhi.</p>}
        {phase.estimationReason === 'coefficient_missing' && <p>Isi koefisien K di Pengaturan untuk menghitung riwayat formulasi ini.</p>}
        {phase.estimationReason === 'baseline_unavailable' && phase.history?.status === 'unmeasured' && <p>Belum ada EC sensor yang valid sebelum injeksi; EC campuran saat pupuk ON tidak dijadikan EC awal.</p>}
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
    {cycle && <HstPhaseCard cycle={cycle} compact />}
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
