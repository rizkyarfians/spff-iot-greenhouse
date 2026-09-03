import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTelemetrySensorHealth,
  isActuatorStateMessage,
  isAutomaticControlAckMessage,
  isAutomaticControlConfig,
  isAutomaticControlSyncMessage,
  isCommandAckMessage,
  isPumpCommandMessage,
  isScheduleSyncAckMessage,
  isScheduleSyncMessage,
  isTelemetryMessage,
  mqttTopics,
  parseMqttTopic,
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

test('telemetry health isolates faults per parameter and keeps zero values valid', () => {
  const message = {
    kind: 'telemetry',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    messageId: 'msg-health-1',
    sequence: 2,
    recordedAt: '2026-09-03T11:27:16.000Z',
    sensorValid: false,
    sensorHealth: {
      soil_1_ph: { valid: false, reason: 'crc_error' },
    },
    sensors: {
      soil_1_moisture: 0,
      soil_1_ph: 9,
    },
  };

  assert.equal(isTelemetryMessage(message), true);
  const health = deriveTelemetrySensorHealth(message);
  assert.deepEqual(health.soil_1_moisture, { valid: true });
  assert.deepEqual(health.soil_1_ph, { valid: false, reason: 'crc_error' });
  assert.deepEqual(health.tank_water_distance_cm, {
    valid: false,
    reason: 'not_reported',
  });
  assert.equal(health.battery_voltage, undefined);
  assert.equal(isTelemetryMessage({
    ...message,
    sensorHealth: { invented_sensor: { valid: false } },
  }), false);
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

test('schedule sync validates atomic device snapshot and schedule topic', () => {
  const message = {
    kind: 'schedule_sync',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    revision: 3,
    generatedAt: '2026-08-28T15:20:00.000Z',
    executionAuthority: 'server',
    schedules: [
      {
        scheduleId: 'schedule-water-01',
        targetId: 'pump_water',
        onTime: '07:00:00',
        offTime: '07:10:00',
        repeatRule: 'daily',
        runDate: null,
        timezone: 'Asia/Jakarta',
        enabled: true,
      },
    ],
  };

  assert.equal(isScheduleSyncMessage(message), true);
  assert.equal(isScheduleSyncMessage({
    ...message,
    schedules: [...message.schedules, message.schedules[0]],
  }), false);
  assert.deepEqual(
    parseMqttTopic(mqttTopics.schedules('greenhouse-01', 'esp32-s3-01')),
    {
      siteId: 'greenhouse-01',
      deviceId: 'esp32-s3-01',
      channel: 'schedules',
    },
  );
});

test('schedule sync acknowledgement validates revision and stored count', () => {
  const acknowledgement = {
    kind: 'schedule_sync_ack',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    revision: 3,
    acknowledgedAt: '2026-08-28T15:20:01.000Z',
    status: 'applied',
    storedScheduleCount: 1,
  };

  assert.equal(isScheduleSyncAckMessage(acknowledgement), true);
  assert.equal(isScheduleSyncAckMessage({
    ...acknowledgement,
    storedScheduleCount: -1,
  }), false);
});

test('automatic control validates hysteresis, EC ordering, and MQTT topic', () => {
  const config = {
    desiredMode: 'automatic',
    water: {
      enabled: true,
      sensorKey: 'soil_1_moisture',
      moistureLowPercent: 35,
      moistureTargetPercent: 55,
      maxRuntimeSeconds: 900,
      cooldownSeconds: 300,
      minTankLevelPercent: 20,
      minFlowLpm: 0.1,
      triggerSampleCount: 3,
      sensorStaleSeconds: 120,
    },
    fertilizer: {
      enabled: false,
      sensorKey: 'liquid_ec_us_cm',
      ecLowUsCm: null,
      ecTargetUsCm: null,
      ecHighUsCm: null,
      dosePulseSeconds: null,
      mixingDelaySeconds: null,
      cooldownSeconds: null,
      maxDoseVolumeL: null,
      maxDailyVolumeL: null,
      minTankLevelPercent: null,
      minFlowLpm: null,
      triggerSampleCount: 3,
      sensorStaleSeconds: 120,
    },
  };
  const message = {
    kind: 'automatic_control_sync',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    revision: 2,
    generatedAt: '2026-08-30T03:00:00.000Z',
    config,
  };
  assert.equal(isAutomaticControlConfig(config), true);
  assert.equal(isAutomaticControlSyncMessage(message), true);
  assert.equal(isAutomaticControlConfig({
    ...config,
    water: { ...config.water, moistureTargetPercent: 30 },
  }), false);
  assert.deepEqual(
    parseMqttTopic(mqttTopics.automaticControl('greenhouse-01', 'esp32-s3-01')),
    {
      siteId: 'greenhouse-01',
      deviceId: 'esp32-s3-01',
      channel: 'automatic-control',
    },
  );
});

test('automatic control acknowledgement requires applied mode', () => {
  const acknowledgement = {
    kind: 'automatic_control_ack',
    schemaVersion: 1,
    siteId: 'greenhouse-01',
    deviceId: 'esp32-s3-01',
    revision: 2,
    acknowledgedAt: '2026-08-30T03:00:01.000Z',
    status: 'applied',
    appliedMode: 'automatic',
  };
  assert.equal(isAutomaticControlAckMessage(acknowledgement), true);
  assert.equal(isAutomaticControlAckMessage({
    ...acknowledgement,
    appliedMode: 'unknown',
  }), false);
});
