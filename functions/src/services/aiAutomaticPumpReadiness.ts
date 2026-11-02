import {
  aiAutomaticPumpReadinessSchema,
  type AiAutomaticPumpReadiness,
  type UnifiedAiDashboard,
} from '@spff/contracts';
import type { Pool } from 'pg';
import { pool, configuredSiteId } from './postgresRepository.js';

export interface AutomaticPumpEvidence {
  deviceEnabled: boolean;
  deviceOnline: boolean;
  deviceMode: 'manual' | 'automatic' | null;
  statusRecordedAt: Date | string | null;
  firmwareVersion: string | null;
  desiredMode: 'manual' | 'automatic' | null;
  appliedMode: 'manual' | 'automatic' | null;
  autoAckStatus: 'applied' | 'rejected' | null;
  revision: string | number | null;
  acknowledgedRevision: string | number | null;
  waterEnabled: boolean;
  competingCommand: boolean;
}

/** No pump command is published or created. Mode is checked from the ESP32's actual status. */
export function assessAutomaticAiPumpReadiness(
  ai: Pick<UnifiedAiDashboard, 'mode' | 'can_dispatch' | 'status' | 'decision' | 'sensors'>,
  evidence: AutomaticPumpEvidence,
  deviceId: string,
  now: Date = new Date(),
): AiAutomaticPumpReadiness {
  const blockers: AiAutomaticPumpReadiness['blockers'] = [
    'AI_SHADOW_NOT_EXECUTION_AUTHORITY',
    'FIRMWARE_AUTO_AI_ON_UNSUPPORTED',
  ];
  if (!evidence.deviceEnabled) blockers.push('DEVICE_NOT_ENABLED');
  if (ai.status !== 'CURRENT') blockers.push('AI_DECISION_NOT_CURRENT');
  if (ai.decision.type === 'HOLD' || ai.decision.hold_reasons.length > 0) blockers.push('AI_DECISION_HOLD');
  if (ai.sensors.device_mode !== 'automatic') blockers.push('AI_SOURCE_NOT_AUTOMATIC');
  const t = evidence.statusRecordedAt === null ? NaN : new Date(evidence.statusRecordedAt).getTime();
  const ageMs = now.getTime() - t;
  if (!evidence.deviceOnline || !Number.isFinite(ageMs) || ageMs < -5000 || ageMs > 45000) {
    blockers.push('DEVICE_NOT_ONLINE_FRESH');
  }
  if (evidence.deviceMode !== 'automatic') blockers.push('DEVICE_NOT_AUTOMATIC');
  if (evidence.desiredMode !== 'automatic' ||
      evidence.appliedMode !== 'automatic' ||
      evidence.autoAckStatus !== 'applied' ||
      evidence.revision === null ||
      String(evidence.revision) !== String(evidence.acknowledgedRevision)) {
    blockers.push('AUTO_CONFIG_NOT_ACKNOWLEDGED');
  }
  if (!evidence.waterEnabled) blockers.push('AUTO_WATER_NOT_ENABLED');
  if (evidence.competingCommand) blockers.push('COMPETING_COMMAND_IN_FLIGHT');

  // Firmware v1.5.03 explicitly rejects all non-schedule ONs in Automatic:
  // spff sourceDenial="automatic_mode". Even a later firmware "capability"
  // string cannot grant permission without actual protocol/hardware verification.
  return aiAutomaticPumpReadinessSchema.parse({
    schemaVersion: 1,
    stage: 'READ_ONLY_AUTO_COMPATIBILITY',
    canDispatch: false,
    commandCreated: false,
    commandType: 'set_pump',
    targetId: 'pump_water',
    deviceId,
    sourceMode: 'SHADOW_MODE',
    actualMode: evidence.deviceMode,
    desiredMode: evidence.desiredMode,
    appliedMode: evidence.appliedMode,
    firmwareVersion: evidence.firmwareVersion,
    firmwareAutoAiOnVerified: false,
    sourceDecisionStatus: ai.status,
    blockers,
  });
}

/** Reads local PostgreSQL only. No commands, no locks and no state changes. */
export async function readAutomaticPumpEvidence(
  deviceId: string,
  db: Pick<Pool,'query'> = pool,
  siteId: string = configuredSiteId,
): Promise<AutomaticPumpEvidence> {
  const { rows } = await db.query<{
    enabled: boolean;
    online: boolean | null;
    mode: 'manual' | 'automatic' | null;
    recorded_at: Date | null;
    firmware_version: string | null;
    desired_mode: 'manual' | 'automatic' | null;
    applied_mode: 'manual' | 'automatic' | null;
    acknowledgement_status: 'applied' | 'rejected' | null;
    revision: string | null;
    acknowledged_revision: string | null;
    water_enabled: boolean | null;
    competing_command: boolean;
  }>(
    `SELECT d.enabled,
            s.online,s.mode,s.recorded_at,s.firmware_version,
            c.desired_mode,c.applied_mode,c.acknowledgement_status,
            c.revision,c.acknowledged_revision,c.water_enabled,
            EXISTS (
              SELECT 1 FROM spff.control_commands pending
              WHERE pending.site_id=d.site_id AND pending.device_id=d.device_id
                AND pending.status IN ('pending','published','accepted')
                AND pending.expires_at>now()
            ) AS competing_command
     FROM spff.devices d
     LEFT JOIN LATERAL (
       SELECT online,mode,recorded_at,firmware_version
       FROM spff.device_status_events
       WHERE site_id=d.site_id AND device_id=d.device_id
       ORDER BY received_at DESC,device_status_id DESC LIMIT 1
     ) s ON TRUE
     LEFT JOIN spff.device_automatic_control_configs c
       ON c.site_id=d.site_id AND c.device_id=d.device_id
     WHERE d.site_id=$1 AND d.device_id=$2 LIMIT 1`,
    [siteId,deviceId],
  );
  const row=rows[0];
  if (!row) {
    return {
      deviceEnabled:false,deviceOnline:false,deviceMode:null,statusRecordedAt:null,
      firmwareVersion:null,desiredMode:null,appliedMode:null,autoAckStatus:null,
      revision:null,acknowledgedRevision:null,waterEnabled:false,competingCommand:false,
    };
  }
  return {
    deviceEnabled:row.enabled,
    deviceOnline:row.online===true,
    deviceMode:row.mode,
    statusRecordedAt:row.recorded_at,
    firmwareVersion:row.firmware_version,
    desiredMode:row.desired_mode,
    appliedMode:row.applied_mode,
    autoAckStatus:row.acknowledgement_status,
    revision:row.revision,
    acknowledgedRevision:row.acknowledged_revision,
    waterEnabled:row.water_enabled===true,
    competingCommand:row.competing_command,
  };
}
