import { createHash } from 'node:crypto';
import {
  aiVolumeApprovalRequestSchema,
  aiVolumeApprovalSnapshotSchema,
  type AiVolumeApprovalRequest,
  type AiVolumeApprovalSnapshot,
  type UnifiedAiDashboard,
} from '@spff/contracts';
import {
  AiVolumeTrialPreviewBlocked,
  convertAiFuzzyToSoftwareTrial,
} from './aiVolumeTrialConversion.js';

export class AiVolumeApprovalBlocked extends Error {
  constructor(reason: string) {
    super(reason);
  }
}

/** Compare the operator-visible preview with a newly fetched Fuzzy snapshot. */
export function planAiVolumeApproval(
  summary: UnifiedAiDashboard,
  rawRequest: AiVolumeApprovalRequest,
  actor: string,
  now: Date = new Date(),
): AiVolumeApprovalSnapshot {
  const request = aiVolumeApprovalRequestSchema.parse(rawRequest);
  if (!actor.trim() || actor.length > 200) {
    throw new AiVolumeApprovalBlocked('Actor tidak valid.');
  }
  const candidate = convertAiFuzzyToSoftwareTrial(summary, request, now);
  const { expected } = request;
  const exactSource = candidate.source.recordedAt === expected.sourceRecordedAt &&
    candidate.source.configVersion === expected.configVersion &&
    Math.abs(candidate.source.illustrativeWaterL - expected.sourceVolumeL) < 0.000001 &&
    Math.abs(candidate.conversion.targetWaterL - expected.targetWaterL) < 0.000001;
  if (!exactSource) {
    throw new AiVolumeApprovalBlocked('Preview telah berubah; ambil preview baru sebelum approve.');
  }
  // Approval expires even if the AI remains online; it grants NO execution.
  const expiry = Math.min(now.getTime() + 120000, Date.parse(candidate.source.recordedAt) + 120000);
  if (expiry <= now.getTime()) {
    throw new AiVolumeApprovalBlocked('Snapshot sudah kedaluwarsa.');
  }
  return aiVolumeApprovalSnapshotSchema.parse({
    schemaVersion: 1,
    stage: 'APPROVED_DRAFT_ONLY',
    canDispatch: false,
    commandCreated: false,
    approvalId: request.approvalId,
    approvedBy: actor,
    approvedAt: now.toISOString(),
    expiresAt: new Date(expiry).toISOString(),
    candidate,
  });
}

/** SHA-256 binds actor and exact request, including confirmation and expected sensor proof. */
export function aiApprovalRequestFingerprint(request: AiVolumeApprovalRequest, actor: string): string {
  const safe = aiVolumeApprovalRequestSchema.parse(request);
  return createHash('sha256').update(JSON.stringify({actor, request:safe})).digest('hex');
}

export function isApprovalExpired(approval: AiVolumeApprovalSnapshot, now: Date = new Date()): boolean {
  return Date.parse(approval.expiresAt) <= now.getTime();
}
export { AiVolumeTrialPreviewBlocked };
