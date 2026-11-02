import { z } from 'zod';

/**
 * SHADOW Mamdani water volume → bounded, software-test-only trial candidate.
 * This is NOT a pump command, dispatch permission, or device session.
 */
export const aiVolumeTrialPreviewInputSchema = z.object({
  deviceId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  /** Explicit operator testing cap; never inferred from unverified LPM. */
  trialCapL: z.number().finite().min(1).max(100),
  /** Local safety timeout; not an estimate derived from flow history. */
  durationSec: z.number().int().min(5).max(60),
}).strict();
export type AiVolumeTrialPreviewInput = z.infer<typeof aiVolumeTrialPreviewInputSchema>;

export const aiVolumeTrialPreviewSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('SIMULATION_ONLY'),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  mqttPublished: z.literal(false),
  operatorApprovalRequired: z.literal(true),
  source: z.object({
    basis: z.literal('FUZZY_SIMULATION'),
    configVersion: z.string().min(1).max(200),
    recordedAt: z.string().min(1).max(100),
    soilSensorKey: z.enum(['soil_1_moisture','soil_2_moisture']),
    moisturePct: z.number().finite().min(0).max(100),
    fuzzyScore: z.number().finite().min(0).max(1),
    illustrativeWaterL: z.number().finite().positive(),
    decisionStatus: z.enum(['CURRENT','STALE','NO_DECISION']),
    proposedAction: z.string().max(200).nullable(),
  }).strict(),
  conversion: z.object({
    strategy: z.literal('CAP_BY_OPERATOR_TEST_LIMIT'),
    operatorCapL: z.number().finite().min(1).max(100),
    targetWaterL: z.number().finite().min(1).max(100),
    capped: z.boolean(),
    durationSec: z.number().int().min(5).max(60),
    durationBasis: z.literal('OPERATOR_MAX_TIMEOUT_NOT_ESTIMATED_FLOW'),
  }).strict(),
  /** Not a PumpCommandMessage: deliberately has no commandId/issuedAt/expiresAt/requestedBy. */
  commandCandidate: z.object({
    deviceId: z.string().min(1).max(80),
    targetId: z.literal('pump_water'),
    params: z.object({
      isActive: z.literal(true),
      waterTrial: z.object({
        targetWaterL: z.number().finite().min(1).max(100),
        durationSec: z.number().int().min(5).max(60),
      }).strict(),
    }).strict(),
  }).strict(),
}).strict();

export type AiVolumeTrialPreview = z.infer<typeof aiVolumeTrialPreviewSchema>;
