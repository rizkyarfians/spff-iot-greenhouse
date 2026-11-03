import { z } from 'zod';

// Only a water-only, operator-supervised commissioning segment.
// This does not grant fertilizer injection or approve full AI irrigation.
export const aiAccWaterTrialRequestSchema = z.object({
  deviceId: z.string().min(1).max(80),
  commandId: z.string().uuid(),
  expectedAction: z.enum(['IRRIGATE', 'FERTIGATE']),
  expectedEvaluatedAt: z.string().datetime({ offset: true }),
  trialCapL: z.number().finite().min(1).max(5),
  durationSec: z.number().int().min(5).max(30),
  confirmation: z.literal('APPROVE_AI_WATER_ONLY_TRIAL'),
}).strict();
export type AiAccWaterTrialRequest = z.infer<typeof aiAccWaterTrialRequestSchema>;

export const aiAccWaterTrialQueuedSchema = z.object({
  commandId: z.string().uuid(),
  status: z.string().min(1).max(40),
  idempotent: z.boolean(),
  waterOnly: z.literal(true),
  dispatched: z.literal(false),
  actualPumpOn: z.literal(false),
  targetWaterL: z.number().finite().min(1).max(5),
  durationSec: z.number().int().min(5).max(30),
}).strict();
export type AiAccWaterTrialQueued = z.infer<typeof aiAccWaterTrialQueuedSchema>;

export type AiAccTrialStatus = {
  commandId: string;
  status: string;
  reason: string | null;
  deviceAcks: unknown[];
  requested: { targetWaterL: number; durationSec: number } | null;
  measuredVolumeIsUncalibrated: boolean;
};
