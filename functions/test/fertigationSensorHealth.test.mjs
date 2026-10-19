import test from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedFertigationReading as valid } from '../lib/services/fertigationSensorHealth.js';

test('missing, null, incomplete or explicitly faulty health must fail closed', () => {
  for (const health of [undefined, null, {}, { soil_1_moisture: {} },
    { soil_1_moisture: { valid: false } }]) {
    assert.equal(valid('soil_1_moisture', 25, health), false);
  }
});
test('only explicitly valid finite readings in physical ranges pass', () => {
  const checks = [
    ['soil_1_moisture', 0, 100], ['soil_2_moisture', 0, 100],
    ['liquid_ec_us_cm', 0, 100000], ['flow_water_lpm', 0, 10000],
    ['flow_fert_lpm', 0, 10000], ['tank_water_level_pct', 0, 100],
    ['tank_fert_level_pct', 0, 100],
  ];
  for (const [key, min, max] of checks) {
    const health = { [key]: { valid: true } };
    for (const number of [min, max]) assert.equal(valid(key, number, health), true);
    for (const number of [null, Number.NaN, Infinity, -Infinity, min - 1, max + 1]) {
      assert.equal(valid(key, number, health), false);
    }
  }
  assert.equal(valid('unknown', 10, { unknown: { valid: true } }), false);
});
test('a healthy water tank does not validate fertilizer tank, moisture or EC', () => {
  const health = { tank_water_level_pct: { valid: true }, soil_1_moisture: { valid: false } };
  assert.equal(valid('tank_water_level_pct', 55, health), true);
  assert.equal(valid('tank_fert_level_pct', 55, health), false);
  assert.equal(valid('soil_1_moisture', 33, health), false);
  assert.equal(valid('liquid_ec_us_cm', 400, health), false);
});
