import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sensorNotifications } from '../src/sensorNotifications.ts'

const sensor = (id, overrides = {}) => ({
  id, type: id, name: id, groupName: 'Greenhouse', value: null, unit: '%',
  status: 'critical', valid: false, faultReason: 'jsn_no_echo',
  updatedAt: '2026-10-25T15:55:00Z', ...overrides,
})

test('tank distance and derived level produce one notification, stable across repeated packets', () => {
  const records = [sensor('tank_water_level_pct'), sensor('tank_water_distance_cm')]
  const [item] = sensorNotifications(records)
  assert.equal(sensorNotifications(records).length, 1)
  assert.equal(item.title, 'Sensor tandon air gagal membaca')
  assert.match(item.description, /pantulan ultrasonik/)
  assert.equal(item.sensorKey, 'tank_water_level_pct')
  assert.equal(sensorNotifications(records.map(row => ({ ...row, updatedAt: '2026-10-25T15:56:00Z' })))[0].id, item.id)
  assert.equal(sensorNotifications(records.map(row => ({ ...row, faultReason: 'stale_or_missing' })))[0].id, item.id)
})

test('zero is valid, missing health is not a proven sensor fault, optional unreported sensors stay quiet', () => {
  assert.deepEqual(sensorNotifications([
    sensor('tank_water_level_pct', { valid: true, value: 0, faultReason: null }),
    sensor('unknown', { valid: null }),
    sensor('battery_voltage', { faultReason: 'not_reported' }),
  ]), [])
})

test('fault disappears on valid recovery without hiding another failed sensor', () => {
  const results = sensorNotifications([
    sensor('tank_water_level_pct', { valid: true, value: 40 }),
    sensor('soil_1_moisture', { name: 'Kelembapan Tanah 1', faultReason: 'crc_error' }),
  ])
  assert.equal(results.length, 1)
  assert.equal(results[0].title, 'Kelembapan Tanah 1 gagal membaca')
  assert.match(results[0].description, /CRC/)
})

test('water and fertilizer are separate faults, mixed tank reason labels do not duplicate the tank', () => {
  const results = sensorNotifications([
    sensor('tank_water_level_pct', { faultReason: 'stale_or_missing' }),
    sensor('tank_water_distance_cm'), sensor('tank_fert_level_pct'),
  ])
  assert.equal(results.length, 2)
  assert.match(results[0].description, /jsn_no_echo/)
  assert.equal(results[1].title, 'Sensor tandon pupuk gagal membaca')
})
