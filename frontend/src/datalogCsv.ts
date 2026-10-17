// Reuse the formatter rather than doing locale setup for every exported reading.
const timestampFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

export const datalogTimestamp = (recordedAt: string) => timestampFormatter.format(new Date(recordedAt))

export function encodeCsvRows(rows: string[][]): string {
  return rows.map((row) => row.map((value) => {
    const safe = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n') + '\r\n'
}
