import { useEffect, useState } from 'react'

import { fetchHstFertilizationStarts, fetchAutomaticCycleStatus } from './api'

import type { AutomaticCycleStatus } from '@spff/contracts'

export function HstFertilizationNotice({ deviceId }: { deviceId: string }) {

  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchHstFertilizationStarts>>>([])

  const [error, setError] = useState('')

  const [cycle,setCycle]=useState<AutomaticCycleStatus|null>(null)

  useEffect(() => {

    setRows([]);setCycle(null)

    setError('')

    if (!deviceId) return

    const controller = new AbortController()

    let pending = false

    async function refresh() {

      if (pending) return

      pending = true

      try {

        const [next,status] = await Promise.all([fetchHstFertilizationStarts(deviceId, controller.signal),fetchAutomaticCycleStatus(deviceId,controller.signal)])

        if (!controller.signal.aborted) { setRows(next);setCycle(status); setError('') }

      } catch {

        if (!controller.signal.aborted) setError('Status pemupukan HST belum tersedia.')

      } finally { pending = false }

    }

    void refresh()

    const timer = setInterval(() => void refresh(), 30000)

    return () => { controller.abort(); clearInterval(timer) }

  }, [deviceId])

  if (error&&!cycle) return <p role="status">{error}</p>

  const grams=(value:number|null)=>value===null?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(value)+' g'

  const phase=cycle?.phase

  return <>
    {error&&<p role="status">{error} Riwayat terakhir tetap ditampilkan.</p>}

    {cycle&&<article className="page-card" role="status" aria-label="Fase pemupukan dan penyiraman">

      <strong>{cycle.mode==='fertilization'?'Fase pemupukan':cycle.mode==='waiting_off'?'Pemupukan terpenuhi · menunggu pompa OFF':cycle.mode==='watering'?'Penyiraman Fuzzy':'Status fase belum tersedia'}</strong>

      {phase&&<><p>Fase {phase.phaseNumber}: {phase.title} · HST {phase.hst} · {phase.product}</p>

        <div className="hst-figures">

          <div><small>Target</small><strong>{grams(phase.targetG)}</strong></div>

          <div><small>{phase.estimated?'Tercatat (estimasi EC)':'Tercatat diberikan'}</small><strong>{grams(phase.history?.recordedG??phase.deliveredG??0)}</strong></div>

          <div><small>Sisa target tercatat</small><strong>{grams(phase.history?.remainingG??phase.remainingG??phase.targetG)}</strong></div>

        </div></>}

      {phase&&<>
        {phase.history?.status==='empty'&&<p>Belum ada pengiriman yang tercatat untuk fase ini.</p>}
        {phase.history?.status==='unmeasured'&&<p>Riwayat sesi ada; gram yang belum dapat dihitung belum masuk catatan.</p>}
        {phase.history?.lastRecordedAt&&<small>Catatan terakhir: {new Date(phase.history.lastRecordedAt).toLocaleString('id-ID')}</small>}
        {phase.gPerPlant!=null&&<p>Rata-rata: {phase.gPerPlant.toLocaleString('id-ID',{maximumFractionDigits:5})} g/tanaman</p>}
        {phase.coefficient!=null&&<small>K: {phase.coefficient} · Baseline: {phase.baselineEcUs} µS/cm</small>}
        {phase.estimationReason==='coefficient_missing'&&<p>Isi K di Pengaturan untuk menghitung riwayat formulasi ini.</p>}
        {phase.estimationReason==='baseline_unavailable'&&phase.history?.status==='unmeasured'&&<p>Baseline EC air untuk sesi ini belum ditemukan di riwayat.</p>}
        {phase.estimationReason==='estimate_only'&&<p>Estimasi eksperimen; kalibrasi belum diverifikasi untuk progres fase.</p>}
        {phase.estimationReason==='calibration_changed'&&<p>Koefisien fase berbeda dari kalibrasi terbaru. Periksa pengaturan EC.</p>}
        {phase.unmeasuredIntervals!=null&&phase.unmeasuredIntervals>0&&<p>{phase.unmeasuredIntervals} interval belum terukur dan tidak ditambahkan ke estimasi.</p>}
      </>}
      <small>{cycle.mode==='fertilization'?'Fuzzy air ditahan selama fase pemupukan.':cycle.mode==='watering'?'Fuzzy mengendalikan pompa air dalam mode Otomatis.':'Menunggu konfirmasi perangkat.'}</small>

      {!cycle.dispatchEnabled&&<p>Otomasi server belum diaktifkan.</p>}

      {cycle.nextHst!==null&&<p>Fase berikutnya: HST {cycle.nextHst}</p>}

    </article>}

    {rows.map(row => <article className="page-card" key={row.start_id} role="status">

    <strong>{row.status === 'started' ? 'Pemupukan sudah dimulai' :

      row.status === 'queued' ? 'Perintah pemupukan dikirim' : 'Pemupukan perlu diperiksa'}</strong>

    <p>HST {row.hst} · {row.product} · {row.method}</p>

    <small>{row.status === 'started' ? 'Kedua pompa dikonfirmasi ON oleh perangkat.' :

      row.status === 'queued' ? 'Menunggu konfirmasi perangkat.' : 'Periksa status kedua pompa di Kontrol Perangkat.'}</small>

  </article>)}</>

}

