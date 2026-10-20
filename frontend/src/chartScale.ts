/** Stable physical scales prevent small percentage changes looking like a crash. */
export function chartDomain(sensorKey: string, values: number[]) {
  const finite = values.filter(Number.isFinite)
  const low = finite.length ? Math.min(...finite) : 0
  const high = finite.length ? Math.max(...finite) : 0
  if (/moisture|humidity|level_pct/.test(sensorKey)) {
    return { min: Math.min(0, low), max: Math.max(100, high) }
  }
  if (sensorKey.endsWith('_ph')) return { min: Math.min(0, low), max: Math.max(14, high) }
  if (sensorKey === 'ac_power_factor') return { min: Math.min(0, low), max: Math.max(1, high) }
  if (sensorKey.includes('temp')) return { min: Math.min(-10, low), max: Math.max(60, high) }
  const maximum = Math.max(high, 1)
  const step = 10 ** Math.floor(Math.log10(maximum))
  return { min: Math.min(0, low), max: Math.ceil(maximum * 1.1 / step) * step }
}
