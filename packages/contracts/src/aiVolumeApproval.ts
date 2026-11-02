import { z } from 'zod';
import { aiVolumeTrialPreviewInputSchema, aiVolumeTrialPreviewSchema } from './aiVolumeTrial.js';

const expected = z.object({
  sourceRecordedAt: z.string().datetime({ offset: true }),
  sourceVolumeL: z.number().finite().positive(),
  targetWaterL: z.number().finite().min(1).max(100),
  configVersion: z.string().min(1).max(200),
}).strict();

/** This confirmation approves a proposal record, NEVER a pump command. */
export const aiVolumeApprovalRequestSchema = aiVolumeTrialPreviewInputSchema.extend({
  approvalId: z.string().uuid(),
  expected,
  confirmation: z.literal('APPROVE_SHADOW_TRIAL_DRAFT'),
}).strict();
export type AiVolumeApprovalRequest = z.infer<typeof aiVolumeApprovalRequestSchema>;

export const aiVolumeApprovalSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('APPROVED_DRAFT_ONLY'),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  approvalId: z.string().uuid(),
  approvedBy: z.string().min(1).max(200),
  approvedAt: z.string().datetime({offset:true}),
  expiresAt: z.string().datetime({offset:true}),
  candidate: aiVolumeTrialPreviewSchema,
}).strict();
export type AiVolumeApprovalSnapshot = z.infer<typeof aiVolumeApprovalSnapshotSchema>;

export const aiVolumeApprovalQueueRequestSchema = z.object({
  confirmation: z.literal('QUEUE_APPROVED_WATER_TRIAL'),
}).strict();
