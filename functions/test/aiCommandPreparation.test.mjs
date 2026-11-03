import assert from 'node:assert/strict';
import test from 'node:test';
import { aiCommandPreparationSchema } from '@spff/contracts';
import { prepareAiCommandPreview } from '../lib/services/aiCommandPreparation.js';

const id = 'a5b4f011-c0f0-4591-8024-781e3c3c913f';
const now = new Date('2026-11-03T03:00:00.000Z');

function fixture(overrides = {}) {
  return {
    status: 'STALE',
    planning_source: 'POSTGRES_READ_ONLY',
    planning_status: 'CURRENT',
    evaluated_at: '2026-11-01T10:46:56.258014+00:00',
    planning_recorded_at: '2026-11-03T02:00:00+00:00',
    decision: {
      type: 'HOLD', proposed_action: 'FERTIGATE',
      hold_reasons: ['manual_mode_blocks_automatic_start'], configuration_version: null,
    },
    sensors: { device_mode: 'manual' },
    tank_preview: { level_status: 'NO_DATA' },
    fertilizer_tank_preview: { level_status: 'NO_DATA' },
    feedback: { status: 'STALE', reported_off: false, boot_matches: false,
      water_pump: null, fert_pump: null },
    calculation: { water_l: null, duration_seconds: null },
    flow_reference: { basis: 'UNVERIFIED_HISTORICAL_COUNTER_DELTAS' },
    fuzzy_preview_blockers: [],
    fuzzy_preview: { illustrative_water_l: 103.9 },
    ...overrides,
  };
}

test('preparation is a short-lived, non-executable preview; Fuzzy is display-only', () => {
  const preview = prepareAiCommandPreview(fixture(), id, now);
  assert.equal(aiCommandPreparationSchema.safeParse(preview).success, true);
  assert.equal(preview.previewId, id);
  assert.equal(preview.preparedAt, '2026-11-03T03:00:00.000Z');
  assert.equal(preview.previewExpiresAt, '2026-11-03T03:02:00.000Z');
  assert.equal(preview.intent, 'FERTIGATE');
  assert.equal(preview.canDispatch, false);
  assert.equal(preview.commandCreated, false);
  assert.equal(preview.command.commandId, null);
  assert.equal(preview.command.targetId, null);
  assert.equal(preview.command.params, null);
  assert.equal(preview.executablePayload, null);
  assert.equal(preview.readiness.illustrativeWater.volumeL, 103.9);
  assert.ok(preview.gates.includes('FIRMWARE_SESSION_PROTOCOL_NOT_VERIFIED'));
});

test('even optimistic-looking input cannot be turned into an actuator command', () => {
  const preview = prepareAiCommandPreview(fixture({
    status: 'CURRENT', planning_status: 'CURRENT',
    decision: { type: 'IRRIGATE', proposed_action: 'IRRIGATE',
      hold_reasons: [], configuration_version: 'validated' },
    sensors: { device_mode: 'automatic' },
    tank_preview: { level_status: 'ESTIMATED' },
    fertilizer_tank_preview: { level_status: 'ESTIMATED' },
    feedback: { status: 'REPORTED_OFF_FRESH', reported_off: true, boot_matches: true,
      water_pump: false, fert_pump: false },
    calculation: { water_l: 20, duration_seconds: 60 },
    flow_reference: null,
  }), id, now);
  assert.equal(preview.intent, 'IRRIGATE');
  assert.equal(preview.command.commandId, null);
  assert.equal(preview.status, 'BLOCKED');
  assert.equal(aiCommandPreparationSchema.safeParse({ ...preview, canDispatch: true }).success, false);
  assert.equal(aiCommandPreparationSchema.safeParse({ ...preview, commandCreated: true }).success, false);
  assert.equal(aiCommandPreparationSchema.safeParse({
    ...preview, command: { ...preview.command, targetId: 'water_pump' },
  }).success, false);
  assert.equal(aiCommandPreparationSchema.safeParse({
    ...preview, executablePayload: { kind: 'command' },
  }).success, false);
});

test('unknown actions stay unmapped rather than guessing a pump', () => {
  const unknown = prepareAiCommandPreview(fixture({
    decision: { type: 'HOLD', proposed_action: 'DOSING_UNKNOWN',
      hold_reasons: ['unknown'], configuration_version: null },
  }), id, now);
  assert.equal(unknown.intent, 'UNMAPPED');
  assert.equal(unknown.command.targetId, null);
  const missing = prepareAiCommandPreview(fixture({
    decision: { type: null, proposed_action: null, hold_reasons: [],
      configuration_version: null },
  }), id, now);
  assert.equal(missing.intent, 'NO_DECISION');
  assert.equal(missing.executablePayload, null);
});

test('invalid preview ID and timestamp are rejected by shared contract', () => {
  assert.throws(() => prepareAiCommandPreview(fixture(), 'not-a-uuid', now));
  assert.throws(() => prepareAiCommandPreview(fixture(), id, new Date('invalid')));
});
