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
