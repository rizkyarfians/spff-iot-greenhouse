import { useEffect, useState } from 'react'
import { fetchHstFertilizationStarts } from './api'

export function HstFertilizationNotice({ deviceId }: { deviceId: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchHstFertilizationStarts>>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    setRows([])
    setError('')
    if (!deviceId) return
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const next = await fetchHstFertilizationStarts(deviceId, controller.signal)
        if (!controller.signal.aborted) { setRows(next); setError('') }
      } catch {
        if (!controller.signal.aborted) setError('Status pemupukan HST belum tersedia.')
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [deviceId])
  if (error) return <p role="status">{error}</p>
  return <>{rows.map(row => <article className="page-card" key={row.start_id} role="status">
    <strong>{row.status === 'started' ? 'Pemupukan sudah dimulai' :
      row.status === 'queued' ? 'Perintah pemupukan dikirim' : 'Pemupukan perlu diperiksa'}</strong>
    <p>HST {row.hst} · {row.product} · {row.method}</p>
    <small>{row.status === 'started' ? 'Kedua pompa dikonfirmasi ON oleh perangkat.' :
      row.status === 'queued' ? 'Menunggu konfirmasi perangkat.' : 'Periksa status kedua pompa di Kontrol Perangkat.'}</small>
  </article>)}</>
}
