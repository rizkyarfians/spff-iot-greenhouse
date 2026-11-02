import { randomUUID } from 'node:crypto';
import {
  aiVolumeApprovalRequestSchema,
  aiVolumeApprovalSnapshotSchema,
  aiVolumeApprovalQueueRequestSchema,
  waterTrialRequestSchema,
  type AiVolumeApprovalRequest,
  type UnifiedAiDashboard,
} from '@spff/contracts';
import type { Pool } from 'pg';
import { pool, configuredSiteId } from './postgresRepository.js';
import {
  aiApprovalRequestFingerprint,
  isApprovalExpired,
  planAiVolumeApproval,
  AiVolumeApprovalBlocked,
} from './aiVolumeApprovalPlanning.js';
import { convertAiFuzzyToSoftwareTrial } from './aiVolumeTrialConversion.js';
import { createWaterTrial } from './waterTrialService.js';

type ApprovalRow = {
  approval_snapshot: unknown;
  request_fingerprint: string;
  approved_by: string;
  status: 'approved' | 'queueing' | 'queued';
  command_id: string;
  expires_at: Date;
};
const requireRow = (value: ApprovalRow | undefined): ApprovalRow => {
  if (!value) throw new AiVolumeApprovalBlocked('Approval tidak ditemukan.');
  return value;
};
function resultOf(row: ApprovalRow, idempotent: boolean) {
  return {
    approval: aiVolumeApprovalSnapshotSchema.parse(row.approval_snapshot),
    status: row.status,
    idempotent,
    commandId: row.status === 'queued' ? row.command_id : null,
    canDispatch: false as const,
  };
}

/** Approval is a durable non-actuating draft, not authorization to operate hardware. */
export async function approveAiVolumeTrial(
  requestUnknown: AiVolumeApprovalRequest,
  actor: string,
  summary: UnifiedAiDashboard,
  db: Pool = pool,
  siteId: string = configuredSiteId,
) {
  const request = aiVolumeApprovalRequestSchema.parse(requestUnknown);
  const fingerprint = aiApprovalRequestFingerprint(request, actor);
  const old = await db.query<ApprovalRow>(
    'SELECT approval_snapshot,request_fingerprint,approved_by,status,command_id,expires_at FROM spff.ai_volume_trial_approvals WHERE site_id=$1 AND approval_id=$2',
    [siteId,request.approvalId],
  );
  if (old.rows[0]) {
    if (old.rows[0].request_fingerprint !== fingerprint || old.rows[0].approved_by !== actor) {
      throw new AiVolumeApprovalBlocked('approvalId sudah digunakan untuk permintaan lain.');
    }
    return resultOf(old.rows[0], true);
  }
  const snapshot = planAiVolumeApproval(summary, request, actor);
  const commandId = 'ai-trial-' + randomUUID();
  await db.query(
    `INSERT INTO spff.ai_volume_trial_approvals(
      site_id,approval_id,device_id,approved_by,request_fingerprint,
      request_snapshot,approval_snapshot,source_recorded_at,source_volume_l,
      target_water_l,duration_sec,command_id,approved_at,expires_at
    )
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT(site_id,approval_id) DO NOTHING`,
    [
      siteId, request.approvalId, request.deviceId, actor, fingerprint,
      JSON.stringify(request), JSON.stringify(snapshot), snapshot.candidate.source.recordedAt,
      snapshot.candidate.source.illustrativeWaterL, snapshot.candidate.conversion.targetWaterL,
      snapshot.candidate.conversion.durationSec, commandId,
      snapshot.approvedAt, snapshot.expiresAt,
    ],
  );
  const found = requireRow((await db.query<ApprovalRow>(
    'SELECT approval_snapshot,request_fingerprint,approved_by,status,command_id,expires_at FROM spff.ai_volume_trial_approvals WHERE site_id=$1 AND approval_id=$2',
    [siteId,request.approvalId],
  )).rows[0]);
  if (found.request_fingerprint !== fingerprint || found.approved_by !== actor) {
    throw new AiVolumeApprovalBlocked('approvalId conflict.');
  }
  return resultOf(found, found.command_id !== commandId);
}

export async function getAiVolumeApproval(
  approvalId: string,
  db: Pool = pool,
  siteId: string = configuredSiteId,
) {
  const row = (await db.query<ApprovalRow>(
    'SELECT approval_snapshot,request_fingerprint,approved_by,status,command_id,expires_at FROM spff.ai_volume_trial_approvals WHERE site_id=$1 AND approval_id=$2',
    [siteId,approvalId],
  )).rows[0];
  return row ? resultOf(row,false) : null;
}

/**
 * Future explicit second action. Dispatch is disabled by DEFAULT and must pass
 * both AI-specific and existing Water Trial feature gates, followed by all
 * device/mode/firmware/interlock checks in createWaterTrial().
 * Callers never supply a command payload or arbitrary volume.
 */
export async function queueApprovedAiVolumeTrial(
  approvalId: string,
  confirmation: unknown,
  actor: string,
  freshSummary: UnifiedAiDashboard,
  db: Pool = pool,
  siteId: string = configuredSiteId,
) {
  aiVolumeApprovalQueueRequestSchema.parse(confirmation);
  if (process.env.SPFF_AI_FUZZY_TRIAL_DISPATCH_ENABLED !== 'true' ||
      process.env.SPFF_WATER_TRIAL_DISPATCH_ENABLED !== 'true') {
    throw new AiVolumeApprovalBlocked('Dispatch AI trial tetap nonaktif; tidak ada command dibuat.');
  }
  if (siteId !== configuredSiteId) {
    throw new AiVolumeApprovalBlocked('Identitas site approval tidak cocok dengan command writer.');
  }
  const row = requireRow((await db.query<ApprovalRow>(
    'SELECT approval_snapshot,request_fingerprint,approved_by,status,command_id,expires_at FROM spff.ai_volume_trial_approvals WHERE site_id=$1 AND approval_id=$2',
    [siteId,approvalId],
  )).rows[0]);
  if (row.approved_by !== actor) {
    throw new AiVolumeApprovalBlocked('Hanya admin yang menyetujui draft ini boleh mengantrekan.');
  }
  if (row.status === 'queued') return resultOf(row, true);
  const approval = aiVolumeApprovalSnapshotSchema.parse(row.approval_snapshot);
  if (isApprovalExpired(approval)) {
    throw new AiVolumeApprovalBlocked('Approval sudah kedaluwarsa; buat preview dan approval baru.');
  }
  // An AI HOLD/STALE decision is never an execution authorization, even if
  // its fresh Fuzzy preview may be stored as an advisory approval draft.
  if (freshSummary.status !== 'CURRENT' ||
      freshSummary.decision.type === 'HOLD' ||
      freshSummary.decision.hold_reasons.length > 0) {
    throw new AiVolumeApprovalBlocked('Keputusan AI belum CURRENT tanpa HOLD; tidak boleh antre command.');
  }
  // Recalculate from fresh PostgreSQL snapshot before any DB command write.
  const expected = approval.candidate;
  const fresh = convertAiFuzzyToSoftwareTrial(freshSummary, {
    deviceId: expected.commandCandidate.deviceId,
    trialCapL: expected.conversion.operatorCapL,
    durationSec: expected.conversion.durationSec,
  });
  if (fresh.source.recordedAt !== expected.source.recordedAt ||
      fresh.source.configVersion !== expected.source.configVersion ||
      Math.abs(fresh.source.illustrativeWaterL - expected.source.illustrativeWaterL) > 0.000001 ||
      Math.abs(fresh.conversion.targetWaterL - expected.conversion.targetWaterL) > 0.000001) {
    throw new AiVolumeApprovalBlocked('Sumber Fuzzy berubah sejak approval; buat approval baru.');
  }
  const cmd = waterTrialRequestSchema.parse({
    deviceId: approval.candidate.commandCandidate.deviceId,
    commandId: row.command_id,
    targetWaterL: approval.candidate.conversion.targetWaterL,
    durationSec: approval.candidate.conversion.durationSec,
    confirmation: 'RUN_CALIBRATION_TRIAL',
  });
  // Keep an immutable source identifier in the command payload.
  const provenance = {
    source: 'ai-shadow-approved-water-trial' as const,
    approvalId,
    approvalFingerprint: row.request_fingerprint,
    fuzzyRecordedAt: approval.candidate.source.recordedAt,
  };
  await db.query(
    `UPDATE spff.ai_volume_trial_approvals SET status='queueing'
     WHERE site_id=$1 AND approval_id=$2 AND status IN ('approved','queueing')`,
    [siteId,approvalId],
  );
  // Hardware safety checks run in the existing server authorizer. The
  // existing 1.5.03 firmware fails the 1.5.04 capability check here.
  let issued: Awaited<ReturnType<typeof createWaterTrial>>;
  try {
    issued = await createWaterTrial(cmd,actor,provenance);
  } catch (error) {
    // Failures in the existing safety gate must not leave a phantom in-flight
    // approval when no durable command exists. Never undo a real queued row.
    const exists = await db.query(
      'SELECT 1 FROM spff.control_commands WHERE site_id=$1 AND command_id=$2',
      [siteId,row.command_id],
    );
    if (exists.rowCount === 0) {
      await db.query(
        `UPDATE spff.ai_volume_trial_approvals SET status='approved'
         WHERE site_id=$1 AND approval_id=$2 AND status='queueing'`,
        [siteId,approvalId],
      );
    }
    throw error;
  }
  await db.query(
    `UPDATE spff.ai_volume_trial_approvals
     SET status='queued',queued_at=COALESCE(queued_at,now())
     WHERE site_id=$1 AND approval_id=$2 AND status='queueing'`,
    [siteId,approvalId],
  );
  return {
    approvalId,
    commandId: issued.commandId,
    status: 'queued' as const,
    idempotent: issued.idempotent,
    // A pending DB command is NOT an ACK or physical actuation proof.
    commandStatus: issued.status,
    commandCreated: true as const,
    awaitingDeviceAck: true as const,
  };
}
