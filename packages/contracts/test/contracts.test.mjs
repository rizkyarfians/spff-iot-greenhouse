import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isActuatorStateMessage,
  isCommandAckMessage,
  isPumpCommandMessage,
  isTelemetryMessage,
  telemetrySensorKeys,
} from '../dist/index.js';

test('telemetry contract exposes all 28 PostgreSQL sensor keys', () => {
  assert.equal(telemetrySensorKeys.length, 28);
  assert.ok(telemetrySensorKeys.includes('soil_1_moisture'));
  assert.ok(telemetrySensorKeys.includes('battery_voltage'));
});

test('telemetry accepts SPFF schema keys and rejects unknown keys', () => {
  const base = {
    kind: 'telemetry',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: 'msg-1',
    sequence: 1,
    recordedAt: '2026-08-17T06:00:00.000Z',
  };
  assert.equal(isTelemetryMessage({ ...base, sensors: { soil_1_moisture: 65, battery_voltage: 12.4 } }), true);
  assert.equal(isTelemetryMessage({ ...base, sensors: { invented_sensor: 123 } }), false);
});

test('command validates expiry and acknowledgement actual state', () => {
  assert.equal(isPumpCommandMessage({
    kind: 'command', schemaVersion: 1, siteId: 'greenhouse-01', deviceId: 'esp32-s3-01',
    commandId: 'cmd-1', issuedAt: '2026-08-17T06:00:00.000Z', expiresAt: '2026-08-17T06:00:30.000Z',
    requestedBy: 'operator', type: 'set_pump', targetId: 'pump_water', params: { isActive: true },
  }), true);
  assert.equal(isCommandAckMessage({
    kind: 'command_ack', schemaVersion: 1, siteId: 'greenhouse-01', deviceId: 'esp32-s3-01',
    commandId: 'cmd-1', acknowledgedAt: '2026-08-17T06:00:05.000Z', status: 'completed',
    targetId: 'pump_water', actualState: { isActive: true },
  }), true);
});

test('actuator state validates actual pump state for retained state topic', () => {
  const state = {
    kind: 'actuator_state', schemaVersion: 1,
    siteId: 'greenhouse-01', deviceId: 'esp32-s3-01',
    messageId: 'state-1', recordedAt: '2026-08-17T06:00:00.000Z',
    targetId: 'pump_water', state: 'active', isActive: true,
    commandId: 'cmd-1',
  };
  assert.equal(isActuatorStateMessage(state), true);
  assert.equal(isActuatorStateMessage({ ...state, isActive: false }), false);
  assert.equal(isActuatorStateMessage({ ...state, commandId: 123 }), false);
});
