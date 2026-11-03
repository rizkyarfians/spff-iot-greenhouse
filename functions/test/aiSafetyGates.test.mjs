import assert from 'node:assert/strict';
import test from 'node:test';
import { aiSafetyEvidenceSchema } from '@spff/contracts';
import { assessAiSafetyEvidence } from '../lib/services/aiSafetyGates.js';
import { getAiSafetyDatabaseConfig } from '../lib/services/aiSafetyPgRepository.js';

const now = new Date('2026-11-03T03:00:00.000Z');
const at = '2026-11-03T02:59:50.000Z';
const rows = () => ({
  device: { enabled: true },
  status: { online: true, mode: 'automatic', firmware_version: 'test-version',
    recorded_at: at, received_at: at,
    raw_payload: { waterInterlockEnabled: true, waterInterlockRevision: 2 } },
  telemetry: { recorded_at: at, received_at: at, sensor_valid: true },
  actuators: ['pump_water', 'pump_fert'].map(actuator_key => ({
    actuator_key, state: 'inactive', is_active: false, source: 'telemetry',
    recorded_at: at, received_at: at,
  })),
  automatic: { desired_mode: 'automatic', applied_mode: 'automatic',
    revision: 3, acknowledged_revision: 3, acknowledgement_status: 'applied' },
  interlock: { enabled: true, applied_enabled: true, revision: 2,
    acknowledged_revision: 2, acknowledgement_status: 'applied' },
  unfinished: false, schedules: false, soilSession: false, adaptiveSession: false,
});

test('fresh PG observations can pass individual gates but never authorize dispatch', () => {
  const x = assessAiSafetyEvidence('greenhouse-01', 'esp32-01', rows(), now, 'POSTGRES_READ_ONLY');
  assert.equal(aiSafetyEvidenceSchema.safeParse(x).success, true);
  assert.equal(x.checks.deviceOnlineFresh, 'PASS');
  assert.equal(x.checks.bothPumpsReportedOff, 'PASS');
  assert.equal(x.checks.waterInterlockConfirmed, 'PASS');
  assert.equal(x.checks.automaticModeAcknowledged, 'PASS');
  assert.equal(x.checks.bootIdentityVerified, 'UNKNOWN');
  assert.equal(x.checks.hydraulicCalibrationVerified, 'UNKNOWN');
  assert.equal(x.status, 'BLOCKED');
  assert.equal(x.canDispatch, false);
  assert.equal(x.commandCreated, false);
  assert.equal(aiSafetyEvidenceSchema.safeParse({ ...x, canDispatch: true }).success, false);
});

test('stale and missing feedback always blocks, never infers OFF', () => {
  const x = rows();
  x.status.recorded_at = '2026-11-03T02:40:00.000Z';
  x.actuators[0].state = 'offline';
  const report = assessAiSafetyEvidence('greenhouse-01', 'esp32-01', x, now, 'POSTGRES_READ_ONLY');
  assert.equal(report.checks.deviceOnlineFresh, 'BLOCKED');
  assert.equal(report.checks.bothPumpsReportedOff, 'BLOCKED');
  assert.equal(report.checks.waterInterlockConfirmed, 'BLOCKED');
  assert.equal(report.checks.automaticModeAcknowledged, 'BLOCKED');
  assert.equal(report.canDispatch, false);
});

test('pending commands and any owning sessions block conflict checks', () => {
  const x = { ...rows(), unfinished: true, schedules: true, soilSession: true };
  const report = assessAiSafetyEvidence('greenhouse-01', 'esp32-01', x, now, 'POSTGRES_READ_ONLY');
  assert.equal(report.checks.noUnfinishedCommands, 'BLOCKED');
  assert.equal(report.checks.noEnabledPumpSchedules, 'BLOCKED');
  assert.equal(report.checks.noRelayOwningSessions, 'BLOCKED');
});

test('unconfigured or unavailable PostgreSQL remains fail-closed', () => {
  for (const source of ['NOT_CONFIGURED', 'UNAVAILABLE']) {
    const x = assessAiSafetyEvidence(null, null, null, now, source);
    assert.equal(x.status, 'BLOCKED');
    assert.ok(Object.values(x.checks).every(value => value === 'UNKNOWN'));
    assert.equal(x.deviceLastSeenAt, null);
    assert.equal(x.canDispatch, false);
  }
});

test('dedicated safety DB configuration must be explicitly opted in', () => {
  const env = {
    SPFF_AI_SAFETY_SITE_ID: 'greenhouse-01',
    SPFF_AI_SAFETY_DEVICE_ID: 'esp32-01',
    SPFF_AI_SAFETY_PGHOST: '127.0.0.1',
    SPFF_AI_SAFETY_PGDATABASE: 'spff',
    SPFF_AI_SAFETY_PGUSER: 'spff_ai_readonly',
    SPFF_AI_SAFETY_PGPASSWORD: 'test',
    PGUSER: 'spff_app',
  };
  assert.equal(getAiSafetyDatabaseConfig(env).configured, false);
  assert.equal(getAiSafetyDatabaseConfig({
    ...env, SPFF_AI_SAFETY_DB_ENABLED: 'true',
  }).configured, true);
  assert.equal(getAiSafetyDatabaseConfig({
    ...env, SPFF_AI_SAFETY_DB_ENABLED: 'true', SPFF_AI_SAFETY_DEVICE_ID: '../oops',
  }).configured, false);
  assert.equal(getAiSafetyDatabaseConfig({
    ...env, SPFF_AI_SAFETY_DB_ENABLED: 'true', SPFF_AI_SAFETY_PGPASSWORD: '',
  }).configured, false);
});
