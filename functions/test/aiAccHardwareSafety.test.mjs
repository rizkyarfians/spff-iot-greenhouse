import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireAiAccHardwareEvidence,
  requireAiAccInterlockAgreement,
} from '../lib/services/aiAccHardwareSafety.js';

const now = new Date('2026-11-03T14:40:00.000Z');
const device = {
  online: true, mode: 'automatic',
  recorded_at: new Date('2026-11-03T14:39:53.000Z'),
  received_at: new Date('2026-11-03T14:39:54.000Z'),
  firmware_version: '1.5.07-AI-ACC-SESSION',
  raw_payload: {
    aiAccWaterTrialCapable: true, timedWaterTrialCapable: true,
    aiAccTankGuardCapable: true, aiAccTankGuardHealthy: true,
    pumpReadbackValid: true, pumpWaterActualActive: false,
    pumpFertActualActive: false, aiAccSessionActive: false,
    pulseBootId: '2161619b66b63eac', waterInterlockEnabled: false,
  },
};
const interlockOff = {
  enabled: false, applied_enabled: false,
  acknowledgement_status: 'applied',
  revision: 12, acknowledged_revision: 12,
};

test('1.5.07 permits intentional dashboard interlock OFF ONLY with healthy independent MCU tank guard', () => {
  const result = requireAiAccHardwareEvidence(device, now);
  assert.equal(result.bootId, '2161619b66b63eac');
  assert.equal(result.interlockEnabled, false);
  assert.doesNotThrow(() => requireAiAccInterlockAgreement(interlockOff, false));
  assert.doesNotThrow(() => requireAiAccInterlockAgreement({
    ...interlockOff, enabled: true, applied_enabled: true,
  }, true));
});

test('reject unknown firmware version and unconfigured executor', () => {
  assert.throws(() => requireAiAccHardwareEvidence({
    ...device, firmware_version: '1.5.06-TIMED-WATER-AI-GUARD',
  }, now));
  assert.throws(() => requireAiAccHardwareEvidence({
    ...device, raw_payload: {...device.raw_payload, aiAccWaterTrialCapable:false},
  }, now));
});

test('reject stale, future, offline, manual or incomplete heartbeats', () => {
  for (const patch of [
    {mode:'manual'}, {online:false}, {received_at:new Date('2026-11-03T14:38:00Z')},
    {recorded_at:new Date('2026-11-03T14:40:10Z')},
    {raw_payload:{...device.raw_payload, pulseBootId:null}},
  ]) {
    assert.throws(() => requireAiAccHardwareEvidence({...device,...patch},now));
  }
});

test('reject tank unsafe, invalid readback, pump running, concurrent AI session', () => {
  for (const patch of [
    {aiAccTankGuardHealthy: false}, {aiAccTankGuardCapable:false},
    {pumpReadbackValid:false}, {pumpWaterActualActive:true},
    {pumpFertActualActive:true}, {pumpWaterActualActive:null},
    {aiAccSessionActive:true}, {timedWaterTrialCapable:false},
  ]) {
    assert.throws(() => requireAiAccHardwareEvidence({
      ...device,raw_payload:{...device.raw_payload,...patch}
    },now),JSON.stringify(patch));
  }
});

test('interlock OFF is a configuration choice but requires matching applied ACK and MCU state', () => {
  for (const mismatch of [
    {...interlockOff, enabled:true},
    {...interlockOff, applied_enabled:true},
    {...interlockOff, acknowledgement_status:'pending'},
    {...interlockOff, acknowledged_revision:11},
    {...interlockOff, applied_enabled:null},
  ]) {
    assert.throws(() => requireAiAccInterlockAgreement(mismatch,false),
      JSON.stringify(mismatch));
  }
  assert.throws(() => requireAiAccInterlockAgreement(interlockOff,true));
  assert.throws(() => requireAiAccInterlockAgreement(undefined,false));
});
