import assert from 'node:assert/strict';
import test from 'node:test';
import { IngestionService } from '../dist/ingestionService.js';

function repositorySpy() {
  const calls = [];
  return {
    calls,
    saveTelemetry: async (message) => calls.push(['telemetry', message]),
    saveActuatorState: async (message) => calls.push(['state', message]),
    saveAcknowledgement: async (message) => calls.push(['ack', message]),
    saveScheduleSyncAck: async (message) => calls.push(['schedule_ack', message]),
    saveDeviceStatus: async (message) => calls.push(['status', message]),
  };
}

test('state topic is validated and sent to actuator state repository', async () => {
  const repository = repositorySpy();
  const service = new IngestionService(repository);
  const payload = Buffer.from(JSON.stringify({
    kind: 'actuator_state', schemaVersion: 1,
    siteId: 'greenhouse-01', deviceId: 'esp32-s3-01',
    messageId: 'state-1', recordedAt: '2026-08-17T06:00:00.000Z',
    commandId: 'cmd-1', targetId: 'pump_water',
    state: 'inactive', isActive: false,
  }));
  await service.process('spff/v1/greenhouse-01/esp32-s3-01/state', payload);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0][0], 'state');
  assert.equal(repository.calls[0][1].commandId, 'cmd-1');
});

test('topic identity mismatch is rejected', async () => {
  const repository = repositorySpy();
  const service = new IngestionService(repository);
  const payload = Buffer.from(JSON.stringify({
    kind: 'device_status', schemaVersion: 1,
    siteId: 'other-site', deviceId: 'esp32-s3-01',
    messageId: 'status-1', recordedAt: '2026-08-17T06:00:00.000Z',
    online: true, mode: 'automatic',
  }));
  await assert.rejects(() => service.process('spff/v1/greenhouse-01/esp32-s3-01/status', payload));
  assert.equal(repository.calls.length, 0);
});

test('schedule sync acknowledgement is validated and stored', async () => {
  const repository = repositorySpy();
  const service = new IngestionService(repository);
  const payload = Buffer.from(JSON.stringify({
    kind: 'schedule_sync_ack',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    revision: 7,
    acknowledgedAt: '2026-08-28T15:20:00.000Z',
    status: 'applied',
    storedScheduleCount: 2,
  }));

  await service.process(
    'spff/v1/greenhouse-01/esp32-s3-01/ack',
    payload,
  );

  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0][0], 'schedule_ack');
  assert.equal(repository.calls[0][1].revision, 7);
});
