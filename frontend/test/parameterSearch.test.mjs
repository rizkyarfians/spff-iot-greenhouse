import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterParameters } from '../src/parameterSearch.ts'

const options = [
  { value: 'tank_water_level_pct', label: 'Level Tandon Air · %', group: 'Greenhouse' },
  { value: 'tank_water_distance_cm', label: 'Jarak Sensor Tandon Air · cm', group: 'Greenhouse' },
  { value: 'tank_fert_level_pct', label: 'Level Tandon Pupuk · %', group: 'Greenhouse' },
  { value: 'tank_fert_distance_cm', label: 'Jarak Sensor Tandon Pupuk · cm', group: 'Greenhouse' },
  { value: 'ac_voltage_v', label: 'Tegangan AC · V', group: 'Energi' },
  { value: 'battery_voltage', label: 'Tegangan Baterai · V', group: 'Energi' },
]
const values = query => filterParameters(options, query).map(option => option.value)

test('water search finds related tank parameters rather than only the current data page', () => {
  assert.deepEqual(values('air'), ['tank_water_level_pct', 'tank_water_distance_cm'])
  assert.deepEqual(values('TANGKI AIR'), ['tank_water_level_pct', 'tank_water_distance_cm'])
  assert.deepEqual(values('jarak permukaan air'), ['tank_water_distance_cm'])
  assert.deepEqual(values('stok'), ['tank_fert_level_pct', 'tank_fert_distance_cm'])
})

test('search matches catalog groups, units, keys and aliases across chart categories', () => {
  assert.deepEqual(values('energi'), ['ac_voltage_v', 'battery_voltage'])
  assert.deepEqual(values('cm'), ['tank_water_distance_cm', 'tank_fert_distance_cm'])
  assert.deepEqual(values('tank_water_level'), ['tank_water_level_pct'])
  assert.deepEqual(values('batre'), ['battery_voltage'])
  assert.deepEqual(values('listrik tegangan'), ['ac_voltage_v'])
})

test('blank search retains order, unknown search is empty and source options are unchanged', () => {
  const before = structuredClone(options)
  assert.deepEqual(filterParameters(options, '  '), options)
  assert.deepEqual(values('bukanparameter'), [])
  assert.deepEqual(values('jarak air pupuk'), [])
  assert.deepEqual(options, before)
})

test('catalog labels support case, punctuation and diacritic normalization', () => {
  assert.deepEqual(filterParameters([{ value: 'custom', label: 'Sénsor-Air' }], 'sensor AIR'), [
    { value: 'custom', label: 'Sénsor-Air' },
  ])
  assert.equal(filterParameters([{ value: 'ec', label: 'EC · µS/cm' }], 'us/cm').length, 1)
})

test('pump aliases retain exact actuator IDs without guessing new parameters', () => {
  const pumps = [{ value: 'pump_water', label: 'Pompa Air' }, { value: 'pump_fert', label: 'Pompa Pupuk' }]
  assert.deepEqual(filterParameters(pumps, 'water').map(option => option.value), ['pump_water'])
  assert.deepEqual(filterParameters([], 'air'), [])
})
