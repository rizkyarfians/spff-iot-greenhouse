/** Advisory preflight for a future standalone-AI command adapter.
 * This contract intentionally cannot represent approval or physical dispatch.
 */
import { z } from 'zod';

export const aiDispatchBlockerSchema = z.enum([
  'SHADOW_MODE',
  'COMMAND_EXECUTOR_NOT_IMPLEMENTED',
  'NO_CALIBRATED_HYDRAULICS',
  'AI_DECISION_NOT_CURRENT',
  'AI_DECISION_ON_HOLD',
  'PLANNING_SOURCE_NOT_LIVE',
  'PLANNING_NOT_CURRENT',
  'OPERATIONAL_PLAN_MISSING',
  'PROFILE_NOT_VALIDATED',
  'MANUAL_OPERATOR_LOCKOUT',
  'WATER_LEVEL_NOT_VERIFIED',
  'STOCK_LEVEL_NOT_VERIFIED',
  'OUTPUT_FEEDBACK_NOT_VERIFIED',
  'HISTORICAL_FLOW_UNVERIFIED',
]);

export type AiDispatchBlocker = z.infer<typeof aiDispatchBlockerSchema>;

export const aiDispatchReadinessSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('READ_ONLY_PREFLIGHT'),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  sourceMode: z.literal('SHADOW_MODE'),
  decisionStatus: z.enum(['CURRENT', 'STALE', 'NO_DECISION']),
  planningStatus: z.enum(['CURRENT', 'STALE', 'UNAVAILABLE']),
  proposedAction: z.string().max(80).nullable(),
  decisionEvaluatedAt: z.string().max(200).nullable(),
  planningRecordedAt: z.string().max(200).nullable(),
  /** Display-only Mamdani volume. Never pass to control_commands. */
  illustrativeWater: z.object({
    basis: z.literal('FUZZY_SIMULATION'),
    volumeL: z.number().finite().nonnegative(),
  }).strict().nullable(),
  /** These may be historical when decisionStatus is STALE. */
  sourceHoldReasons: z.array(z.string().max(200)).max(80),
  blockers: z.array(aiDispatchBlockerSchema).min(2).max(24),
}).strict();

export type AiDispatchReadiness = z.infer<typeof aiDispatchReadinessSchema>;
