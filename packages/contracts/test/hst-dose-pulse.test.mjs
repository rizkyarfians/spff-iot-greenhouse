import test from 'node:test';
import assert from 'node:assert/strict';
import { measureHstDosePulse, planHstDosePulse } from '../dist/hstDosePulse.js';

test('HST pulse respects the remaining mass and the firmware pulse window', () => {
  const observedFlow = 21.83; // Simulation only. This observed peak is not a commissioned bound.
  assert.deepEqual(planHstDosePulse(100, 4, observedFlow), { onDurationMs: 30_000, waterWithPulse: true });
  assert.deepEqual(planHstDosePulse(4, 4, observedFlow), { onDurationMs: 2748, waterWithPulse: true });
  assert.equal(planHstDosePulse(1, 4, observedFlow), null);
  assert.throws(() => planHstDosePulse(4, 4, 0), RangeError);
});

const reading = (recordedAtMs, totalL, patch = {}) => ({
  recordedAtMs, totalL, bootId: 'f151ff9a22285d51', valid: true, ...patch,
});
const evidence = {
  before: reading(1000, 11.967),
  startedAtMs: 2000,
  pumpsOffAtMs: 3000,
  concentrationGPerL: 4,
  after: [reading(4000, 14.902), reading(5000, 14.902)],
};

test('credits the stable totalizer delta after verified OFF', () => {
  const measured = measureHstDosePulse(evidence);
  assert.ok(Math.abs(measured.stockL - 2.935) < 1e-9);
  assert.ok(Math.abs(measured.deliveredG - 11.74) < 1e-9);
});

test('rejects delayed, drifting, reset, invalid or cross-boot evidence', () => {
  for (const after of [
    [reading(3000, 14.902), reading(5000, 14.902)],
    [reading(4000, 14.902), reading(4000, 14.902)],
    [reading(4000, 14.902), reading(5000, 15)],
    [reading(4000, 0), reading(5000, 0)],
    [reading(4000, 14.902, { valid: false }), reading(5000, 14.902)],
    [reading(4000, 14.902), reading(5000, 14.902, { bootId: 'other' })],
  ]) {
    assert.equal(measureHstDosePulse({ ...evidence, after }), null);
  }
});
