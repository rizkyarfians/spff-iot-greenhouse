import test from 'node:test';
import assert from 'node:assert/strict';

const {
  parseRealtimeEvent,
} = await import('../lib/services/realtimeEventHub.js');


test('accepts a persisted telemetry notification', () => {
  const event = parseRealtimeEvent(JSON.stringify({
    type: 'telemetry.updated',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: 'msg-001',
    recordedAt: '2026-08-27T11:21:28.000Z',
    receivedAt: '2026-08-27T11:23:11.059Z',
  }));

  assert.deepEqual(event, {
    type: 'telemetry.updated',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: 'msg-001',
    recordedAt: '2026-08-27T11:21:28.000Z',
    receivedAt: '2026-08-27T11:23:11.059Z',
  });
});


test('accepts a device status notification without a message id', () => {
  const event = parseRealtimeEvent(JSON.stringify({
    type: 'device_status.updated',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: null,
    recordedAt: '2026-08-27T11:21:28.000Z',
    receivedAt: '2026-08-27T11:23:11.059Z',
  }));

  assert.equal(event?.messageId, null);
  assert.equal(event?.type, 'device_status.updated');
});


test('accepts an actuator state notification', () => {
  const event = parseRealtimeEvent(JSON.stringify({
    type: 'actuator_state.updated',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: 'pump-water-state-001',
    recordedAt: '2026-08-27T11:21:28.000Z',
    receivedAt: '2026-08-27T11:23:11.059Z',
  }));

  assert.equal(event?.type, 'actuator_state.updated');
  assert.equal(event?.messageId, 'pump-water-state-001');
});

test('accepts an alarm incident notification', () => {
  const event = parseRealtimeEvent(JSON.stringify({
    type: 'alarm.updated',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: '42',
    recordedAt: '2026-08-30T10:00:00.000Z',
    receivedAt: '2026-08-30T10:00:00.010Z',
  }));

  assert.equal(event?.type, 'alarm.updated');
  assert.equal(event?.messageId, '42');
});

test('accepts an automatic control revision notification', () => {
  const event = parseRealtimeEvent(JSON.stringify({
    type: 'automatic_control.updated',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: '3',
    recordedAt: '2026-08-30T10:00:00.000Z',
    receivedAt: '2026-08-30T10:00:00.010Z',
  }));
  assert.equal(event?.type, 'automatic_control.updated');
  assert.equal(event?.messageId, '3');
});


test('rejects malformed or unsupported notifications', () => {
  assert.equal(parseRealtimeEvent(undefined), null);
  assert.equal(parseRealtimeEvent('{invalid-json'), null);
  assert.equal(parseRealtimeEvent(JSON.stringify({
    type: 'alarm.updated',
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: 'msg-001',
    recordedAt: 'not-a-date',
    receivedAt: '2026-08-27T11:23:11.059Z',
  })), null);
});
