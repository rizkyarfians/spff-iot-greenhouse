import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiHstApprovalRequestSchema,
  aiHstApprovalResultSchema,
  aiHstProposalsSchema,
  aiHstExecutionReadinessSchema,
  aiHstRealPreflightSchema,
} from '../dist/index.js';

const obligationId = 'a'.repeat(64);

test('HST list stays non-actuating and validates mass progress', () => {
  const valid = {
    schemaVersion: 1, status: 'READY', can_dispatch: false, proposals: [{
      obligation_id: obligationId,
      program_id: 'program-1', activity_id: 'row-11', source_row: 11,
      hst: 10, due_date: '2026-11-04', product: 'Phonska plus',
      created_at: '2026-11-04T02:00:00+00:00',
      proposed_action: 'FERTIGATE', mode: 'SHADOW_MODE',
      target_g: 50000, delivered_g: 20000, remaining_g: 30000,
      status: 'PARTIAL_WAITING_APPROVAL', review_reasons: [],
      approval_count: 1, can_dispatch: false,
    }],
  };
  assert.equal(aiHstProposalsSchema.safeParse(valid).success, true);
  assert.equal(aiHstProposalsSchema.safeParse({
    ...valid, proposals: [{ ...valid.proposals[0], can_dispatch: true }],
  }).success, false);
  assert.equal(aiHstProposalsSchema.safeParse({
    ...valid, proposals: [{ ...valid.proposals[0], remaining_g: -100 }],
  }).success, false);
});

test('HST ACC request forbids client-chosen actor and requires bounded remaining', () => {
  const valid = {
    obligationId, approvalId: '11111111-1111-4111-8111-111111111111',
    expectedRemainingG: 30000, confirmation: 'REVIEW_HST_SHADOW_SESSION',
  };
  assert.equal(aiHstApprovalRequestSchema.safeParse(valid).success, true);
  assert.equal(aiHstApprovalRequestSchema.safeParse({
    ...valid, actor: 'impersonated-admin',
  }).success, false);
  assert.equal(aiHstApprovalRequestSchema.safeParse({
    ...valid, expectedRemainingG: 0,
  }).success, false);
});

test('HST ACC review only accepts SHADOW_BLOCKED without actuator dispatch', () => {
  const valid = {
    schemaVersion: 1,
    approval_id: '11111111-1111-4111-8111-111111111111',
    obligation_id: obligationId,
    operator_id: 'operator',
    approved_at: '2026-11-04T02:00:00+00:00',
    approval_date: '2026-11-04',
    expected_remaining_g: 30000,
    status: 'SHADOW_REVIEW_BLOCKED',
    can_dispatch: false,
    command_created: false,
    dispatch_status: 'NOT_DISPATCHED',
    hold_reasons: ['shadow_mode_no_fertigation_dispatch'],
    sensor_evidence: {
      message_id: 'frame-1',
      recorded_at: '2026-11-04T01:59:55+00:00',
      water_tank_pct: 90,
      fertilizer_tank_pct: 80,
      soil_2_moisture_pct: 40,
      water_valid: true,
      fertilizer_valid: true,
      soil_2_valid: true,
      device_mode: 'automatic',
      device_recorded_at: '2026-11-04T01:59:58+00:00',
    },
    plan: null,
  };
  assert.equal(aiHstApprovalResultSchema.safeParse(valid).success, true);
  assert.equal(aiHstApprovalResultSchema.safeParse({
    ...valid, command_created: true,
  }).success, false);
});


test('HST execution readiness requires a consistent explicit server capability', () => {
  const blocked = {
    schemaVersion: 1, runningMode: 'SHADOW_MODE', canDispatch: false,
    realTest: { ready: false, blockers: ['firmware_contract_unverified'] },
  };
  assert.equal(aiHstExecutionReadinessSchema.safeParse(blocked).success, true);
  assert.equal(aiHstExecutionReadinessSchema.safeParse({
    ...blocked, canDispatch: true,
  }).success, false);
  assert.equal(aiHstExecutionReadinessSchema.safeParse({
    ...blocked, realTest: { ready: true, blockers: [] },
  }).success, false);
  assert.equal(aiHstExecutionReadinessSchema.safeParse({
    ...blocked, canDispatch:true, realTest:{ready:true,blockers:[]},
  }).success, true);
});


test('per-obligation HST real preflight always forbids actuation',()=>{
 const block={schemaVersion:1,obligationId, status:'BLOCKED', setup:null,
  reasons:['one_verified_fertilizer_product_per_session_required'],canDispatch:false};
 assert.equal(aiHstRealPreflightSchema.safeParse(block).success,true);
 assert.equal(aiHstRealPreflightSchema.safeParse({...block,canDispatch:true}).success,false);
 assert.equal(aiHstRealPreflightSchema.safeParse({...block,status:'READY',reasons:[]}).success,false);
 assert.equal(aiHstRealPreflightSchema.safeParse({
  ...block,status:'READY',reasons:[],canDispatch:true,
 }).success,true);
});
