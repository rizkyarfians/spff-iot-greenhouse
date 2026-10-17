import type { ApiDatalogExportEvent, ApiDatalogItem } from '@spff/contracts'

/** Consume framed JSON incrementally; EOF alone never means a successful export. */
export async function readDatalogExportStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onBatch: (items: ApiDatalogItem[]) => Promise<void>,
): Promise<number> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  let started = false
  let complete = false
  let rowCount = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })

  const accept = async (line: string) => {
    if (!line.trim()) return
    if (complete) throw new Error('Respons ekspor tidak valid setelah selesai.')
    const event = JSON.parse(line) as ApiDatalogExportEvent
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'start' && !started) {
      started = true
    } else if (event.type === 'batch' && started && Array.isArray(event.items)) {
      signal.throwIfAborted()
      await onBatch(event.items)
      rowCount += event.items.length
    } else if (event.type === 'complete' && started && event.rowCount === rowCount) {
      complete = true
    } else {
      throw new Error('Respons ekspor tidak valid. Silakan coba lagi.')
    }
  }

  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      pending += decoder.decode(value, { stream: !done })
      let newline: number
      while ((newline = pending.indexOf('\n')) !== -1) {
        await accept(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
      if (pending.length > 8 * 1024 * 1024) throw new Error('Potongan ekspor terlalu besar.')
      if (done) break
    }
    await accept(pending)
    signal.throwIfAborted()
    if (!complete) throw new Error('Ekspor terputus sebelum selesai. File belum disimpan; coba lagi.')
    return rowCount
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
