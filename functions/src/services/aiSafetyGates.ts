import {
  aiSafetyEvidenceSchema,
  type AiSafetyEvidence,
} from '@spff/contracts';

type Stamp = Date | string | null;
export interface AiSafetyRows {
  device: { enabled: boolean } | null;
  status: {
    online: boolean; mode: string | null; firmware_version: string | null;
    recorded_at: Stamp; received_at: Stamp; raw_payload: unknown;
  } | null;
  telemetry: { recorded_at: Stamp; received_at: Stamp; sensor_valid: boolean | null } | null;
  actuators: Array<{
    actuator_key: string; state: string; is_active: boolean | null;
    source: string; recorded_at: Stamp; received_at: Stamp;
  }>;
  automatic: {
    revision: number | string; acknowledged_revision: number | string | null;
    acknowledgement_status: string | null; desired_mode: string; applied_mode: string | null;
  } | null;
  interlock: {
    revision: number; enabled: boolean; acknowledged_revision: number | null;
    acknowledgement_status: string | null; applied_enabled: boolean | null;
  } | null;
  unfinished: boolean;
  schedules: boolean;
  soilSession: boolean;
  adaptiveSession: boolean;
}

type Gate = 'PASS' | 'BLOCKED' | 'UNKNOWN';
const UNKNOWN = 'UNKNOWN' as const;
const thresholdMs = { device: 90_000, telemetry: 120_000, actuator: 90_000 };
function iso(stamp: Stamp | undefined): string | null {
  if (!stamp) return null;
  const date = stamp instanceof Date ? stamp : new Date(stamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function fresh(recordedAt: Stamp | undefined, receivedAt: Stamp | undefined,
               now: Date, limitMs: number): boolean {
  const recorded = iso(recordedAt), received = iso(receivedAt);
  if (!recorded || !received) return false;
  const nowMs = now.getTime(), recordedMs = Date.parse(recorded), receivedMs = Date.parse(received);
  return nowMs - recordedMs <= limitMs && recordedMs - nowMs <= 5000
    && nowMs - receivedMs <= limitMs && receivedMs - nowMs <= 5000;
}

const names = [
  'deviceEnabled', 'deviceOnlineFresh', 'telemetryFresh', 'automaticModeAcknowledged',
  'bothPumpsReportedOff', 'waterInterlockConfirmed', 'noUnfinishedCommands',
  'noEnabledPumpSchedules', 'noRelayOwningSessions', 'bootIdentityVerified',
  'hydraulicCalibrationVerified',
] as const;

/** Advisory only: neither this nor its PASS gates can approve a command. */
export function assessAiSafetyEvidence(
  siteId: string | null, deviceId: string | null, rows: AiSafetyRows | null,
  collectedAt: Date, source: AiSafetyEvidence['source'],
): AiSafetyEvidence {
  const statusFresh = rows?.status
    ? fresh(rows.status.recorded_at, rows.status.received_at, collectedAt, thresholdMs.device)
    : false;
  const telemetryFresh = rows?.telemetry
    ? fresh(rows.telemetry.recorded_at, rows.telemetry.received_at, collectedAt, thresholdMs.telemetry)
    : false;

  const pumpsOff = (['pump_water', 'pump_fert'] as const).every(key => {
    const state = rows?.actuators.find(p => p.actuator_key === key);
    return state !== undefined && state.state === 'inactive' && state.is_active === false
      && ['telemetry', 'command_ack'].includes(state.source)
      && fresh(state.recorded_at, state.received_at, collectedAt, thresholdMs.actuator);
  });
  const raw = rows?.status?.raw_payload;
  const payload = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const cfg = rows?.interlock;
  const reportedRevision = payload.waterInterlockRevision;
  const interlockOk = statusFresh && cfg?.enabled === true
    && cfg.applied_enabled === true && cfg.acknowledgement_status === 'applied'
    && cfg.acknowledged_revision === cfg.revision
    && payload.waterInterlockEnabled === true
    && reportedRevision === cfg.revision;
  const modeCfg = rows?.automatic;
  const modeOk = statusFresh && rows?.status?.mode === 'automatic'
    && modeCfg?.desired_mode === 'automatic' && modeCfg.applied_mode === 'automatic'
    && modeCfg.acknowledgement_status === 'applied'
    && modeCfg.acknowledged_revision != null
    && Number(modeCfg.acknowledged_revision) === Number(modeCfg.revision);

  const observed = source === 'POSTGRES_READ_ONLY' && rows !== null;
  const check = (value: boolean): Gate => observed ? (value ? 'PASS' : 'BLOCKED') : UNKNOWN;
  const checks = {
    deviceEnabled: check(rows?.device?.enabled === true),
    deviceOnlineFresh: check(statusFresh && rows?.status?.online === true),
    telemetryFresh: check(telemetryFresh && rows?.telemetry?.sensor_valid === true),
    automaticModeAcknowledged: check(modeOk),
    bothPumpsReportedOff: check(pumpsOff),
    waterInterlockConfirmed: check(interlockOk),
    noUnfinishedCommands: check(rows?.unfinished === false),
    noEnabledPumpSchedules: check(rows?.schedules === false),
    noRelayOwningSessions: check(rows?.soilSession === false && rows?.adaptiveSession === false),
    // No validated boot/session identity contract or hydraulic calibration path yet.
    bootIdentityVerified: UNKNOWN,
    hydraulicCalibrationVerified: UNKNOWN,
  } as const;

  return aiSafetyEvidenceSchema.parse({
    schemaVersion: 1,
    stage: 'READ_ONLY_SAFETY_EVIDENCE',
    source,
    status: 'BLOCKED',
    canDispatch: false,
    commandCreated: false,
    collectedAt: collectedAt.toISOString(),
    siteId, deviceId,
    deviceLastSeenAt: observed ? iso(rows?.status?.recorded_at) : null,
    telemetryRecordedAt: observed ? iso(rows?.telemetry?.recorded_at) : null,
    reportedMode: observed && (rows?.status?.mode === 'manual' || rows?.status?.mode === 'automatic')
      ? rows?.status?.mode : null,
    firmwareVersion: observed && typeof rows?.status?.firmware_version === 'string'
      ? rows.status.firmware_version.slice(0,120) : null,
    checks,
    blockers: [
      ...(source !== 'POSTGRES_READ_ONLY' ? [source] : []),
      ...names.filter(name => checks[name] !== 'PASS'),
    ],
    note: 'Observasi saja; status PASS tidak mengizinkan command.',
  });
}
