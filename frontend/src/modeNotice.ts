type Mode = 'manual' | 'automatic'
type Ack = {
  revision: number
  acknowledgedRevision: number | null
  acknowledgementStatus: string | null
  appliedMode: Mode | null
}

export function modeNotice(
  request: { mode: Mode; revision: number },
  current: Ack | null | undefined,
) {
  const name = request.mode === 'automatic' ? 'Otomatis' : 'Manual'
  if (current && current.revision > request.revision) {
    return { tone: 'pending', text: 'Pilihan mode sudah diperbarui. Periksa mode terbaru pada alat.' }
  }
  if (current?.revision === request.revision && current.acknowledgedRevision === request.revision) {
    if (current.acknowledgementStatus === 'rejected') {
      return { tone: 'error', text: `Alat menolak mode ${name}. Mode pada alat belum berubah.` }
    }
    if (current.acknowledgementStatus === 'applied' && current.appliedMode === request.mode) {
      return { tone: 'success', text: `Mode ${name} sudah diterapkan pada alat.` }
    }
  }
  return { tone: 'pending', text: `Pilihan ${name} tersimpan. Menunggu konfirmasi alat; mode belum dipastikan berubah.` }
}
