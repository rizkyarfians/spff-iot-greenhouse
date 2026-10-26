import test from 'node:test';
import assert from 'node:assert/strict';
import { planAdaptiveFertigation, stockVolumeAtLevel } from '../lib/services/fertigationPlanner.js';
import { fertigationPlannerMutationSchema, fertigationPlannerProfileSchema, fertigationPlannerIdentitySchema } from '@spff/contracts';

// Synthetic arithmetic fixtures, not crop recommendations or installation calibration.
export const profile = {
  calibrationReference: 'TEST FIXTURE ONLY', plantCount: 100,
  waterLPerPlantPerMoisturePoint: 0.01, maxWaterLPerPlant: 1,
  fertilizerGPerPlant: 1, calibratedWaterLpm: 10, calibratedStockLpm: 1,
  stockFlowMeasuresInjection: true,
  stockTankVolumeCurve: [{ levelPercent: 0, volumeL: 0 }, { levelPercent: 50, volumeL: 20 }, { levelPercent: 100, volumeL: 100 }],
  stockReserveL: 2, maxDailyStockL: 5, stabilizationSeconds: 5, flushWaterL: 5,
  mixingSeconds: 1, ecKpMsPerUsCm: 10, minPulseMs: 1500, maxPulseMs: 10000,
};
const recipe = { targetWaterL: 50, targetStockL: 2, stockConcentrationGPerL: 100,
  moistureLowPercent: 30, moistureTargetPercent: 60,
  ecLowUsCm: 500, ecTargetUsCm: 1000, ecHighUsCm: 1500 };
const snapshot = { moisture: 20, moistureValid: true, liquidEcUsCm: 400, liquidEcValid: true,
  stockTankPercent: 50, stockTankValid: true };
const evidence = { remainingSeconds: 600, dailyStockUsedL: 0, holdReasons: [] };
const run = (r = {}, s = {}, p = {}, e = {}) => planAdaptiveFertigation({ ...recipe, ...r }, { ...snapshot, ...s }, { ...profile, ...p }, { ...evidence, ...e });

test('planner computes crop water, stock mass, calibrated runtime and all water phases within one budget', () => {
  const result = run();
  assert.equal(result.status, 'planned');
  assert.equal(result.feedback, 'liquid_ec_us_cm');
  assert.equal(result.plan.targetWaterL, 40);
  assert.equal(result.plan.targetStockL, 1);
  assert.equal(result.plan.fertilizerMassG, 100);
  assert.equal(result.plan.waterPumpSeconds, 240);
  assert.equal(result.plan.fertilizerPumpOnSeconds, 60);
  assert.equal(result.plan.nextPulseMs, 6000);
  assert.equal(result.plan.availableStockL, 18);
  assert.equal(result.plan.phases.at(-1).phase, 'flush');
  assert.ok(Math.abs(result.plan.phases.reduce((sum, phase) => sum + phase.waterL, 0) - 40) < 1e-9);
  assert.ok(Math.abs(result.plan.phases.reduce((sum, phase) => sum + phase.seconds, 0) - 240) < 1e-9);
  assert.equal(result.canDispatch, false);
  assert.equal(result.simulationOnly, true);
  assert.ok(result.executionBlockers.length > 0);
});
test('water responds to moisture and plant count, with per-plant and per-rule caps', () => {
  assert.equal(run({}, { moisture: 30 }).plan.targetWaterL, 30);
  assert.equal(run({}, {}, { plantCount: 80 }).plan.targetWaterL, 32);
  assert.equal(run({}, {}, { waterLPerPlantPerMoisturePoint: 1 }).plan.targetWaterL, 50);
  assert.equal(run({ targetWaterL: 35 }).plan.targetWaterL, 35);
});
test('EC error adjusts pulse ON time within calibrated limits', () => {
  assert.equal(run({}, { liquidEcUsCm: 500 }).plan.nextPulseMs, 5000);
  assert.equal(run({}, {}, { ecKpMsPerUsCm: 1 }).plan.nextPulseMs, 1500);
  assert.equal(run({}, {}, { ecKpMsPerUsCm: 100 }).plan.nextPulseMs, 10000);
  // A valid agronomic stock cap can shorten a pulse below its EC-derived duration.
  assert.equal(run({ targetStockL: 0.05 }).plan.nextPulseMs, 3000);
  assert.equal(run({ targetStockL: 0.01 }).status, 'hold');
});
test('nonlinear tank calibration is interpolated; low inventory and daily allowance hold the entire plan', () => {
  assert.equal(stockVolumeAtLevel(profile, 25), 10);
  assert.equal(stockVolumeAtLevel(profile, 75), 60);
  assert.equal(run({}, { stockTankPercent: 5 }).status, 'hold');
  assert.equal(run({}, {}, {}, { dailyStockUsedL: 4.5 }).status, 'hold');
  assert.equal(run({}, {}, {}, { dailyStockUsedL: null }).status, 'hold');
});
test('water-only plans do not require stock or EC and contain no fertilizer phase', () => {
  const result = run({ targetStockL: 0, stockConcentrationGPerL: null },
    { liquidEcValid: false, liquidEcUsCm: null, stockTankValid: false, stockTankPercent: null },
    { fertilizerGPerPlant: 0, calibratedStockLpm: null, stockFlowMeasuresInjection: false });
  assert.equal(result.status, 'planned');
  assert.equal(result.plan.targetStockL, 0);
  assert.equal(result.plan.nextPulseMs, 0);
  assert.deepEqual(result.plan.phases, [{ phase: 'irrigate', waterL: 40, seconds: 240 }]);
});
test('schedule reserves minimum-sized adaptive pulses, every mixing delay, and flushing', () => {
  for (const seconds of [null, 0, 239, NaN]) assert.equal(run({}, {}, {}, { remainingSeconds: seconds }).status, 'hold');
  assert.equal(run({ targetWaterL: 5 }).status, 'hold');
  assert.equal(run({}, {}, { mixingSeconds: 10 }).status, 'hold');
  assert.equal(run({}, {}, {}, { remainingSeconds: 240 }).status, 'planned');
});
test('invalid sensors, wrong meter placement, invalid concentration and upstream holds fail closed', () => {
  for (const sensor of [{ moistureValid: false }, { moisture: NaN }, { moisture: 31 },
    { liquidEcValid: false }, { liquidEcUsCm: 1500 }, { stockTankPercent: 101 }, { stockTankValid: false }])
    assert.equal(run({}, sensor).status, 'hold');
  for (const p of [{ stockFlowMeasuresInjection: false }, { calibratedStockLpm: null }, { plantCount: 0 }])
    assert.equal(run({}, {}, p).status, 'hold');
  assert.equal(run({ stockConcentrationGPerL: null }).status, 'hold');
  assert.equal(run({}, {}, {}, { holdReasons: ['ESP32 offline'] }).status, 'hold');
});
test('profile API schemas reject sensor injection and uncalibrated or ambiguous curves', () => {
  const identity = { deviceId: 'esp32-s3-01', recipeId: '00000000-0000-4000-8000-000000000001' };
  assert.equal(fertigationPlannerIdentitySchema.safeParse({ ...identity, liquidEcUsCm: 100 }).success, false);
  assert.equal(fertigationPlannerMutationSchema.safeParse({ ...identity, expectedRevision: 0, expectedRecipeRevision: 1, profile }).success, true);
  assert.equal(fertigationPlannerProfileSchema.safeParse({ ...profile, stockTankVolumeCurve: [profile.stockTankVolumeCurve[1], profile.stockTankVolumeCurve[2]] }).success, false);
  assert.equal(fertigationPlannerProfileSchema.safeParse({ ...profile, stockTankVolumeCurve: [...profile.stockTankVolumeCurve].reverse() }).success, false);
  assert.equal(fertigationPlannerProfileSchema.safeParse({ ...profile, minPulseMs: 10000, maxPulseMs: 1500 }).success, false);
});
