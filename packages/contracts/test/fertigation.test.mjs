import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fertigationRecipeInputSchema,
  fertigationSessionEventSchema,
  fertigationSimulationInputSchema,
} from '../dist/index.js';

const recipe = {
  cropName: 'Terong', hstFrom: 20, hstTo: 40,
  targetWaterL: 10, targetStockL: 0.5,
  fertilizerName: 'Stok pupuk', stockConcentrationGPerL: 100,
  minWaterTankPercent: 15, minStockTankPercent: 20,
  sourceReference: 'Persetujuan agronomi internal 2026/01',
};
test('recipe validates agronomic stock concentration and HST', () => {
  assert.equal(fertigationRecipeInputSchema.safeParse(recipe).success, true);
  assert.equal(fertigationRecipeInputSchema.safeParse({ ...recipe, stockConcentrationGPerL: null }).success, false);
  assert.equal(fertigationRecipeInputSchema.safeParse({ ...recipe, hstFrom: 50 }).success, false);
});
test('simulation requires freshness and explicit selector state', () => {
  assert.equal(fertigationSimulationInputSchema.safeParse({
    recipeId: 'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
    deviceId: 'esp32-s3-01', hst: 30, scheduleDue: true,
    selectorMode: 'automatic', observedAt: '2026-10-18T00:00:00Z',
    slaveFresh: false, waterFlowHealthy: false, stockFlowHealthy: false,
    waterTankPercent: null, stockTankPercent: null,
  }).success, true);
});
test('completed session without feedback proof is rejected', () => {
  const base = {
    kind: 'fertigation_session_event', schemaVersion: 1,
    siteId: 'greenhouse-01', deviceId: 'esp32-s3-01',
    messageId: 'session-event-1', sequence: 1,
    sessionId: 'f247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
    recipeId: 'a247bd02-6c3e-4826-bd10-5fa3bb6fbd26',
    recordedAt: '2026-10-18T00:00:00Z',
    status: 'completed', targetWaterL: 10, targetStockL: 0.5,
    actualWaterL: null, actualStockL: 0.5, pumpsOff: false,
    completionReason: null,
  };
  assert.equal(fertigationSessionEventSchema.safeParse(base).success, false);
  assert.equal(fertigationSessionEventSchema.safeParse({
    ...base, actualWaterL: 9.9, pumpsOff: true,
  }).success, true);
});
