import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFertigation } from '../lib/services/fertigationRules.js';

const recipe = {
  recipeId: 'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
  siteId: 'greenhouse-01',
  cropName: 'Terong', hstFrom: 20, hstTo: 40,
  targetWaterL: 10, targetStockL: 0.5,
  fertilizerName: 'Stok pupuk', stockConcentrationGPerL: 100,
  minWaterTankPercent: 15, minStockTankPercent: 20,
  sourceReference: 'Persetujuan agronomi internal 2026/01',
  approvalStatus: 'approved', approvalReference: 'AGR-001',
  approvedBy: 'agronom', approvedAt: '2026-10-18T00:00:00Z',
};
const input = {
  recipeId: recipe.recipeId,
  deviceId: 'esp32-s3-01', hst: 30, scheduleDue: true,
  selectorMode: 'automatic', observedAt: '2026-10-18T00:00:00Z',
  slaveFresh: true, waterFlowHealthy: true, stockFlowHealthy: true,
  waterTankPercent: 80, stockTankPercent: 50,
};
test('approved valid scenario generates advisory only', () => {
  const result = simulateFertigation(recipe, input);
  assert.equal(result.status, 'suggested');
  assert.equal(result.action, 'FERTIGATE');
  assert.equal(result.publishable, false);
  assert.equal(result.requiresApproval, true);
});
test('unapproved or missing flow sensor causes hold', () => {
  assert.equal(simulateFertigation({ ...recipe, approvalStatus: 'draft' }, input).status, 'hold');
  assert.equal(simulateFertigation(recipe, { ...input, slaveFresh: false }).action, 'DELAY');
  assert.equal(simulateFertigation(recipe, { ...input, stockTankPercent: null }).targetWaterL, null);
  assert.equal(simulateFertigation(recipe, { ...input, selectorMode: 'manual' }).status, 'hold');
});
