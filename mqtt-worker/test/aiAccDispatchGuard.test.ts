import assert from 'node:assert/strict';
import test from 'node:test';
import { aiAccDispatchBlocker } from '../src/aiAccDispatchGuard.js';
import type { PendingControlCommand } from '../src/repository.js';

const now = new Date('2026-11-03T12:50:00.000Z');
const valid: PendingControlCommand = {
  commandId: '135c5802-83fb-428c-bdb2-1153bc364781',
  siteId: 'greenhouse-01',
  deviceId: 'esp32-s3-01',
  actuatorKey: 'pump_water',
  requestedIsActive: true,
  requestedBy: 'trial:water:ai:operator',
  source: 'ai-operator-acc-water-only-trial',
  aiAccConfirmation: 'APPROVE_AI_WATER_ONLY_TRIAL',
  aiAccExpectedEvaluatedAt: '2026-11-03T12:49:50.000Z',
  issuedAt: '2026-11-03T12:49:58.000Z',
  expiresAt: '2026-11-03T12:50:13.000Z',
  waterTrial: { targetWaterL: 2, durationSec: 10, bootId: 'abcdef0123456789' },
};

test('AI worker dispatch remains OFF unless explicitly enabled', () => {
  assert.equal(aiAccDispatchBlocker(valid, false, now), 'ai_worker_dispatch_disabled');
  assert.equal(aiAccDispatchBlocker(valid, true, now), null);
});

test('AI cannot masquerade as ordinary manual or fertilizer command', () => {
  assert.equal(aiAccDispatchBlocker({...valid, source: undefined}, true, now), 'invalid_ai_command_origin');
  assert.equal(aiAccDispatchBlocker({...valid, requestedBy: 'dashboard:operator'}, true, now), 'invalid_ai_command_origin');
  assert.equal(aiAccDispatchBlocker({...valid, actuatorKey: 'pump_fert'}, true, now), 'not_water_only_start');
  assert.equal(aiAccDispatchBlocker({...valid, requestedIsActive: false}, true, now), 'not_water_only_start');
});

test('AI requires boot binding, operator ACC, bounded volume and duration', () => {
  assert.equal(aiAccDispatchBlocker({...valid, aiAccConfirmation: 'yes'}, true, now), 'operator_confirmation_missing');
  assert.equal(aiAccDispatchBlocker({...valid, waterTrial: {...valid.waterTrial!, bootId: undefined}}, true, now), 'invalid_boot_bound_water_trial');
  assert.equal(aiAccDispatchBlocker({...valid, waterTrial: {...valid.waterTrial!, targetWaterL: 20}}, true, now), 'invalid_boot_bound_water_trial');
  assert.equal(aiAccDispatchBlocker({...valid, waterTrial: {...valid.waterTrial!, durationSec: 90}}, true, now), 'invalid_boot_bound_water_trial');
});

test('AI refuses expired, old or invalid evaluation timestamps', () => {
  assert.equal(aiAccDispatchBlocker({...valid, expiresAt: '2026-11-03T12:49:59.000Z'}, true, now), 'stale_or_invalid_ai_command');
  assert.equal(aiAccDispatchBlocker({...valid, aiAccExpectedEvaluatedAt: '2026-11-03T12:45:00Z'}, true, now), 'stale_or_invalid_ai_command');
  assert.equal(aiAccDispatchBlocker({...valid, issuedAt: 'not-a-date'}, true, now), 'stale_or_invalid_ai_command');
});

test('ordinary manual command is not reclassified as AI', () => {
  assert.equal(aiAccDispatchBlocker({
    ...valid, requestedBy: 'dashboard:operator',
    source: undefined, waterTrial: undefined,
  }, false, now), null);
});
