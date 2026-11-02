/** Simulation-only conversion result. No field in this contract grants pump authority. */
import { z } from 'zod';
import { aiDispatchBlockerSchema } from './aiDispatchReadiness.js';

export const aiPumpSimulationSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('AI_PUMP_PROTOCOL_SIMULATION'),
  simulationOnly: z.literal(true),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  mqttPublished: z.literal(false),
  physicalAckReceived: z.literal(false),
  source: z.object({
    basis: z.literal('FUZZY_SIMULATION'),
    recordedAt: z.string().max(200).nullable(),
    inputKey: z.enum(['soil_1_moisture', 'soil_2_moisture']).nullable(),
    illustrativeWaterL: z.number().finite().nonnegative().nullable(),
    decisionStatus: z.enum(['CURRENT','STALE','NO_DECISION']),
    planningStatus: z.enum(['CURRENT','STALE','UNAVAILABLE']),
    proposedAction: z.string().max(200).nullable(),
  }).strict(),
  /** Protocol-only bounded first segment; NOT an approved duration or physical request. */
  mockCandidate: z.object({
    targetWaterL: z.number().finite().min(1).max(100),
    deferredWaterL: z.number().finite().nonnegative(),
    durationSec: z.literal(60),
    durationBasis: z.literal('FIXED_MOCK_TIMEBOX_NOT_HYDRAULIC'),
    targetId: z.literal('pump_water'),
  }).strict().nullable(),
  mockBlockers: z.array(z.enum([
    'FUZZY_PREVIEW_MISSING',
    'PLANNING_NOT_CURRENT',
    'PLANNING_SOURCE_NOT_LIVE',
    'FUZZY_SENSOR_BLOCKED',
    'SOURCE_SNAPSHOT_MISMATCH',
    'FUZZY_VOLUME_TOO_SMALL',
  ])).max(8),
  /** These are real-world blockers, even when a mock candidate is available. */
  dispatchBlockers: z.array(aiDispatchBlockerSchema).min(2).max(24),
  deviceCommandStatus: z.literal('NOT_SENT'),
}).strict();

export type AiPumpSimulation = z.infer<typeof aiPumpSimulationSchema>;
