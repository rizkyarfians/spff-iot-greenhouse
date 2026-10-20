import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartDomain } from '../src/chartScale.ts'

test('one percent variation retains the full percentage axis, including zero', () => {
  for (const key of ['soil_1_moisture', 'air_humidity', 'tank_water_level_pct']) {
    assert.deepEqual(chartDomain(key, [20, 21]), { min: 0, max: 100 })
    assert.deepEqual(chartDomain(key, [0, 20]), { min: 0, max: 100 })
  }
})
test('scales keep outliers visible and support constant or empty readings', () => {
  assert.deepEqual(chartDomain('soil_1_moisture', [-2, 110]), { min: -2, max: 110 })
  assert.deepEqual(chartDomain('liquid_ph', [6, 6]), { min: 0, max: 14 })
  assert.deepEqual(chartDomain('ac_power_factor', []), { min: 0, max: 1 })
  assert.ok(chartDomain('liquid_ec_us_cm', [0]).max > 0)
})
