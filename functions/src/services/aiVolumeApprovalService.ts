import { randomUUID } from 'node:crypto';
import {
  aiVolumeApprovalRequestSchema,
  aiVolumeApprovalSnapshotSchema,
  type AiVolumeApprovalRequest,
} from '@spff/contracts';
import type { Pool } from 'pg';
import { pool, configuredSiteId } from './postgresRepository.js';
import {
  aiApprovalRequestFingerprint,
  planAiVolumeApproval,
  AiVolumeApprovalBlocked,
} from './aiVolumeApprovalPlanning.js';

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
 * Legacy AI Water Trial queue was Manual-only and cannot command the current
 * Automatic firmware. Deliberately fail closed, even if old flags are enabled.
 */
export async function queueApprovedAiVolumeTrial(): Promise<never> {
  throw new AiVolumeApprovalBlocked(
    'AI Water Trial Manual queue sudah dinonaktifkan. Firmware 1.5.03 menolak AI direct-ON saat Automatic.',
  );
}
