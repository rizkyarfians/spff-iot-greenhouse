import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiOperatorAccRequestSchema,
  aiOperatorAccResultSchema,
} from '@spff/contracts';
import { checkOperatorAccDryRun } from '../lib/services/aiOperatorAcc.js';

const request = {
  expectedAction: 'IRRIGATE',
  expectedEvaluatedAt: '2026-11-03T06:00:00.000Z',
  confirmation: 'CHECK_OPERATOR_ACC_DRY_RUN',
};
const now = new Date('2026-11-03T06:00:05.000Z');

function fixture(overrides = {}) {
  return {
    status: 'CURRENT', evaluated_at: request.expectedEvaluatedAt,
    planning_source: 'POSTGRES_READ_ONLY', planning_status: 'CURRENT',
    decision: { type: 'IRRIGATE', proposed_action: 'IRRIGATE', hold_reasons: [], configuration_version: 'validated' },
    sensors: { device_mode: 'automatic' },
    tank_preview: { level_status: 'ESTIMATED' },
    fertilizer_tank_preview: { level_status: 'ESTIMATED' },
    feedback: { status: 'REPORTED_OFF_FRESH', reported_off: true, boot_matches: true, water_pump: false, fert_pump: false },
    calculation: { water_l: 10, duration_seconds: 30 }, flow_reference: null,
    fuzzy_preview_blockers: [], fuzzy_preview: null,
    ...overrides,
  };
}

test('ACC input demands explicit operator confirmation and current decision reference', () => {
  assert.equal(aiOperatorAccRequestSchema.safeParse(request).success, true);
  for (const bad of [
    { confirmation: 'ACC' }, { expectedAction: 'ON' }, { expectedEvaluatedAt: 'yesterday' },
  ]) assert.equal(aiOperatorAccRequestSchema.safeParse({ ...request, ...bad }).success, false);
});

test('even ideal AI source can only produce a blocked dry-run, never an actuator command', () => {
  const result = checkOperatorAccDryRun(fixture(), request, now);
  assert.equal(aiOperatorAccResultSchema.safeParse(result).success, true);
  assert.equal(result.decisionMatched, true);
  assert.equal(result.canDispatch, false);
  assert.equal(result.commandCreated, false);
  assert.equal(result.commandId, null);
  assert.equal(result.mqttPublished, false);
  assert.equal(result.operatorApprovalRecorded, false);
  assert.equal(result.actualPumpState, null);
  assert.ok(result.blockers.includes('FIRMWARE_VOLUME_SESSION_NOT_VERIFIED'));
  assert.equal(aiOperatorAccResultSchema.safeParse({ ...result, canDispatch: true }).success, false);
  assert.equal(aiOperatorAccResultSchema.safeParse({ ...result, commandCreated: true }).success, false);
});

test('changed, stale and HOLD decisions add blockers, not a guessed command', () => {
  const changed = checkOperatorAccDryRun(fixture(), { ...request, expectedEvaluatedAt: '2026-11-03T05:59:00.000Z' }, now);
  assert.equal(changed.decisionMatched, false);
  assert.ok(changed.blockers.includes('REVIEWED_DECISION_CHANGED_OR_ON_HOLD'));
  const old = checkOperatorAccDryRun(fixture({evaluated_at: '2026-11-02T06:00:00.000Z'}), request, now);
  assert.ok(old.blockers.includes('AI_DECISION_NOT_FRESH'));
  const hold = checkOperatorAccDryRun(fixture({
    decision: { type: 'HOLD', proposed_action: 'IRRIGATE', hold_reasons: ['water_unavailable'], configuration_version: null },
  }), request, now);
  assert.equal(hold.decisionMatched, false);
  assert.equal(hold.status, 'BLOCKED');
});
