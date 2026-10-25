export interface ParameterOption {
  value: string
  label: string
  group?: string
}

const aliases: Record<string, string> = {
  tank_water_level_pct: 'isi sisa ketinggian level tandon tangki air water tank',
  tank_water_distance_cm: 'jarak permukaan air jarak tandon tangki air water tank distance',
  tank_fert_level_pct: 'isi sisa ketinggian level tandon tangki pupuk larutan stok fertilizer tank',
  tank_fert_distance_cm: 'jarak permukaan pupuk jarak tandon tangki pupuk larutan stok fertilizer tank distance',
  battery_voltage: 'tegangan baterai batre baterei aki volt energi',
  ac_voltage_v: 'tegangan listrik volt energi',
  ac_current_a: 'arus listrik ampere energi',
  ac_power_w: 'daya listrik watt energi',
  pump_water: 'pompa air water',
  pump_fert: 'pompa pupuk fertilizer',
}

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[µμ]/g, 'u').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Search catalog metadata only; never filter just the currently loaded log page. */
export function filterParameters(options: readonly ParameterOption[], query: string): ParameterOption[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  return options.filter(option => {
    const searchable = normalize(`${option.label} ${option.group ?? ''} ${option.value} ${aliases[option.value] ?? ''}`)
    return words.every(word => searchable.includes(word))
  })
}
