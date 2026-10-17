import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTankLevels } from '../dist/tankLevels.js';

const message = (sensors, extra = {}) => ({
  kind: 'telemetry', schemaVersion: 1, siteId: 'greenhouse-01',
  deviceId: 'esp32-s3-01', messageId: 'test', sequence: 1,
  recordedAt: '2026-10-17T00:00:00Z', sensors, ...extra,
});

test('uses separate tank heights and preserves original payload', () => {
  const input = message({ tank_water_distance_cm: 45, tank_fert_distance_cm: 45 });
  const result = deriveTankLevels(input);
  assert.equal(result.sensors.tank_water_level_pct, 25);
  assert.equal(result.sensors.tank_fert_level_pct, 50);
  assert.equal(input.sensors.tank_water_level_pct, undefined);
});

test('full, empty and partial levels remain valid despite global sensor flag', () => {
  const result = deriveTankLevels(message({ tank_water_distance_cm: 0, tank_fert_distance_cm: 90 }, { sensorValid: false }));
  assert.equal(result.sensors.tank_water_level_pct, 0);
  assert.equal(result.sensors.tank_fert_level_pct, 100);
  assert.equal(result.sensorHealth.tank_fert_level_pct.valid, true);
});

test('reported liquid heights are not inverted into sensor distances', () => {
  const result = deriveTankLevels(message({ tank_water_distance_cm: 0.8, tank_fert_distance_cm: 69.9 }));
  assert.equal(result.sensors.tank_water_level_pct, 0.4);
  assert.equal(result.sensors.tank_fert_level_pct, 77.7);
});

test('missing, invalid and out of range heights do not fabricate levels', () => {
  for (const distance of [undefined, NaN, -1, 181]) {
    const result = deriveTankLevels(message({ tank_water_distance_cm: distance, tank_water_level_pct: 76 }));
    assert.equal(result.sensors.tank_water_level_pct, undefined);
    assert.equal(result.sensorHealth.tank_water_level_pct.valid, false);
  }
  const result = deriveTankLevels(message({ tank_water_distance_cm: 45 }, {
    sensorHealth: { tank_water_distance_cm: { valid: false, reason: 'stale_or_missing' } },
  }));
  assert.equal(result.sensors.tank_water_level_pct, undefined);
  assert.equal(result.sensorHealth.tank_water_level_pct.reason, 'stale_or_missing');
});

test('does not calibrate other installations', () => {
  const result = deriveTankLevels(message({ tank_water_distance_cm: 45 }, { deviceId: 'other' }));
  assert.equal(result.sensors.tank_water_level_pct, undefined);
});
