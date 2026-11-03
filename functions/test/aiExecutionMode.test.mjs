import assert from 'node:assert/strict';
import test from 'node:test';
import { aiExecutionModeUpdateSchema } from '@spff/contracts';
import { verifyAiModeChange, aiLiveSwitchAvailable } from '../lib/services/aiExecutionModeService.js';

const base = {
  deviceId: 'esp32-s3-01',
  expectedRevision: 0,
  mode: 'shadow',
  confirmation: 'CHANGE_AI_MODE',
};
const disabled = { SPFF_AI_ACC_LIVE_SWITCH_ENABLED: 'false', SPFF_AI_ACC_WATER_TRIAL_ENABLED: 'false' };
const enabled = { SPFF_AI_ACC_LIVE_SWITCH_ENABLED: 'true', SPFF_AI_ACC_WATER_TRIAL_ENABLED: 'true' };

test('mode contract rejects unsupported or malformed input', () => {
  assert.equal(aiExecutionModeUpdateSchema.safeParse(base).success, true);
  assert.equal(aiExecutionModeUpdateSchema.safeParse({...base,mode:'automatic'}).success, false);
  assert.equal(aiExecutionModeUpdateSchema.safeParse({...base,expectedRevision:-1}).success, false);
  assert.equal(aiExecutionModeUpdateSchema.safeParse({...base,unknown:true}).success, false);
});

test('OFF and SHADOW remain selectable even with AI execution flags OFF', () => {
  for (const mode of ['off','shadow']) {
    assert.doesNotThrow(() => verifyAiModeChange({...base,mode}, disabled));
  }
  assert.equal(aiLiveSwitchAvailable(disabled), false);
});

test('LIVE requires an explicit commissioning gate AND supervised confirmation', () => {
  const request = {...base,mode:'live',confirmation:'ENABLE_AI_LIVE_SUPERVISED'};
  for (const env of [
    disabled,
    {...disabled, SPFF_AI_ACC_LIVE_SWITCH_ENABLED:'true'},
    {...disabled, SPFF_AI_ACC_WATER_TRIAL_ENABLED:'true'},
  ]) {
    assert.throws(() => verifyAiModeChange(request,env));
  }
  assert.throws(() => verifyAiModeChange({...request,confirmation:'CHANGE_AI_MODE'},enabled));
  assert.equal(aiLiveSwitchAvailable(enabled),true);
  assert.doesNotThrow(() => verifyAiModeChange(request,enabled));
});

test('SHADOW cannot be switched with misleading LIVE confirmation', () => {
  assert.throws(() => verifyAiModeChange({...base,confirmation:'ENABLE_AI_LIVE_SUPERVISED'},enabled));
});
