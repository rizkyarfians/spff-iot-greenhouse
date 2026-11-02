import assert from 'node:assert/strict';
import test from 'node:test';
import { aiDispatchReadinessSchema } from '@spff/contracts';
import { assessAiDispatchReadiness } from '../lib/services/aiDispatchReadiness.js';

function fixture(overrides = {}) {
  return {
    status: 'STALE',
    planning_source: 'POSTGRES_READ_ONLY',
    planning_status: 'CURRENT',
    evaluated_at: '2026-11-01T10:46:56.258014+00:00',
    planning_recorded_at: '2026-11-02T05:36:35+00:00',
    decision: {
      type: 'HOLD', proposed_action: 'FERTIGATE', hold_reasons: ['manual_mode_blocks_automatic_start'],
      configuration_version: null,
    },
    sensors: { device_mode: 'manual' },
    tank_preview: { level_status: 'NO_DATA' },
    fertilizer_tank_preview: { level_status: 'NO_DATA' },
    feedback: {
      status: 'STALE', reported_off: false, boot_matches: false, water_pump: null, fert_pump: null,
    },
    calculation: { water_l: null, duration_seconds: null },
    flow_reference: { basis: 'UNVERIFIED_HISTORICAL_COUNTER_DELTAS' },
    fuzzy_preview_blockers: [],
    fuzzy_preview: { illustrative_water_l: 358.5816587983714 },
    ...overrides,
  };
}

test('preflight reports existing field blockers and labels Fuzzy as illustrative', () => {
  const result = assessAiDispatchReadiness(fixture());
  assert.equal(aiDispatchReadinessSchema.safeParse(result).success, true);
  assert.equal(result.canDispatch, false);
  assert.equal(result.commandCreated, false);
  assert.deepEqual(result.illustrativeWater, {
    basis: 'FUZZY_SIMULATION', volumeL: 358.5816587983714,
  });
  for (const code of [
    'SHADOW_MODE','COMMAND_EXECUTOR_NOT_IMPLEMENTED','NO_CALIBRATED_HYDRAULICS',
    'AI_DECISION_NOT_CURRENT','AI_DECISION_ON_HOLD','OPERATIONAL_PLAN_MISSING',
    'PROFILE_NOT_VALIDATED','MANUAL_OPERATOR_LOCKOUT','WATER_LEVEL_NOT_VERIFIED',
    'STOCK_LEVEL_NOT_VERIFIED','OUTPUT_FEEDBACK_NOT_VERIFIED','HISTORICAL_FLOW_UNVERIFIED',
  ]) assert.ok(result.blockers.includes(code), code);
});

test('even optimistic-looking source values cannot turn preflight into an executable command', () => {
  const result = assessAiDispatchReadiness(fixture({
    status: 'CURRENT', planning_status: 'CURRENT',
    decision: { type: 'IRRIGATE', proposed_action: 'IRRIGATE', hold_reasons: [], configuration_version: 'validated-v2' },
    sensors: {device_mode: 'automatic'},
    tank_preview: {level_status: 'ESTIMATED'},
    fertilizer_tank_preview: {level_status: 'ESTIMATED'},
    feedback: {status: 'REPORTED_OFF_FRESH',reported_off: true,boot_matches: true,water_pump: false,fert_pump: false},
    calculation: {water_l: 20,duration_seconds: 60}, flow_reference: null,
  }));
  assert.equal(result.canDispatch, false);
  assert.equal(result.commandCreated, false);
  assert.ok(result.blockers.includes('COMMAND_EXECUTOR_NOT_IMPLEMENTED'));
  assert.equal(aiDispatchReadinessSchema.safeParse({...result, canDispatch: true}).success, false);
  assert.equal(aiDispatchReadinessSchema.safeParse({...result, commandCreated: true}).success, false);
});

test('missing or stale planning hides illustrative liters rather than inventing a command', () => {
  assert.equal(assessAiDispatchReadiness(fixture({
    planning_status: 'STALE',
  })).illustrativeWater, null);
  assert.equal(assessAiDispatchReadiness(fixture({
    fuzzy_preview_blockers: ['sensor_raw_poll_not_verified'],
  })).illustrativeWater, null);
  assert.equal(assessAiDispatchReadiness(fixture({
    fuzzy_preview: null,
  })).illustrativeWater, null);
});
