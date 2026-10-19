import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSiteFertigation } from '../lib/services/fertigationLiveEvaluation.js';

const now = new Date('2026-10-18T10:00:00.000Z');
const recipe = {
  recipeId: 'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
  siteId: 'greenhouse-01', zoneId: 'soil-1', cropId: 'sweet-potato',
  cropName: 'Ubi Jalar', hstFrom: 10, hstTo: 50,
  targetWaterL: 10, targetStockL: 0,
  fertilizerName: null, stockConcentrationGPerL: null,
  minWaterTankPercent: 15, minStockTankPercent: 15,
  sourceReference: 'Protokol uji', approvalStatus: 'approved',
  approvalReference: 'AGR-1', approvedBy: 'admin',
  approvedAt: now.toISOString(), plantingDate: '2026-09-18',
  applicationDate: '2026-10-18', revision: 2, updatedAt: now.toISOString(),
};
const snapshot = {
  telemetryRecordedAt: new Date('2026-10-18T09:59:55Z'),
  deviceRecordedAt: new Date('2026-10-18T09:59:55Z'),
  deviceOnline: true, deviceMode: 'automatic', automaticMode: 'automatic',
  appliedMode: 'automatic', configRevision: 2, acknowledgedRevision: 2,
  acknowledgementStatus: 'applied',
  actualWaterLpm: 0, actualStockLpm: 0,
  waterTankPercent: 70, stockTankPercent: 50,
  flowWaterValid: true, flowStockValid: true,
  waterTankValid: true, stockTankValid: true,
  activeCropId: 'sweet-potato', moistureSensorKey: 'soil_1_moisture',
  moisture: 22, moistureValid: true,
  moistureLowPercent: 30, moistureTargetPercent: 55,
  liquidEcUsCm: 400, liquidEcValid: true,
  ecLowUsCm: 550, ecHighUsCm: 1200,
};
const evaluate = (r = recipe, s = snapshot) =>
  evaluateSiteFertigation(r, 'esp32-s3-01', s, now);

test('healthy matching site can suggest, but never dispatch a command', () => {
  const result = evaluate();
  assert.equal(result.decision.status, 'suggested');
  assert.equal(result.decision.action, 'IRRIGATE');
  assert.equal(result.decision.publishable, false);
  assert.equal(result.controlStrategy.active, 'legacy_sensor');
  assert.equal(result.controlStrategy.canDispatch, false);
  assert.equal(result.observations.soilMoisturePercent, 22);
});
test('stale telemetry, offline device, or missing firmware ACK holds recommendation', () => {
  assert.equal(evaluate(recipe, { ...snapshot, telemetryRecordedAt: new Date('2026-10-18T09:30:00Z') }).decision.action, 'DELAY');
  assert.equal(evaluate(recipe, { ...snapshot, deviceOnline: false }).decision.status, 'hold');
  assert.equal(evaluate(recipe, { ...snapshot, acknowledgedRevision: 1 }).decision.action, 'DELAY');
});
test('crop binding mismatch and unbound legacy recipe are rejected', () => {
  assert.equal(evaluate(recipe, { ...snapshot, activeCropId: 'tomato' }).decision.action, 'DELAY');
  assert.equal(evaluate({ ...recipe, cropId: null }).decision.status, 'hold');
});
test('soil moisture and EC are meaningful agronomic guards', () => {
  assert.equal(evaluate(recipe, { ...snapshot, moisture: 42 }).decision.action, 'DELAY');
  assert.equal(evaluate(recipe, { ...snapshot, moistureValid: false }).decision.action, 'DELAY');
  const fertilizerRecipe = { ...recipe, targetStockL: 0.5, fertilizerName: 'NPK', stockConcentrationGPerL: 100 };
  assert.equal(evaluate(fertilizerRecipe, snapshot).decision.action, 'FERTIGATE');
  assert.equal(evaluate(fertilizerRecipe, { ...snapshot, liquidEcUsCm: 1250 }).decision.action, 'DELAY');
  assert.equal(evaluate(fertilizerRecipe, { ...snapshot, liquidEcValid: false }).decision.action, 'DELAY');
});
test('draft and mismatched application day are rejected', () => {
  assert.equal(evaluate({ ...recipe, approvalStatus: 'draft' }).decision.status, 'hold');
  assert.equal(evaluate({ ...recipe, applicationDate: null }).decision.action, 'DELAY');
});
