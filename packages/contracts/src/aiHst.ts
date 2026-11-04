import { z } from 'zod';

/** HST proposal is one persisted duty per Guide program/planting/activity/product.
 * This contract is SHADOW-only and never grants actuator authority.
 */
export const aiHstProposalSchema = z.object({
  obligation_id: z.string().regex(/^[a-f0-9]{64}$/),
  program_id: z.string().min(1),
  activity_id: z.string().min(1),
  source_row: z.number().int().positive().nullable(),
  hst: z.number().int().nullable(),
  due_date: z.string().nullable(),
  product: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  proposed_action: z.literal('FERTIGATE'),
  mode: z.literal('SHADOW_MODE'),
  target_g: z.number().finite().nullable(),
  delivered_g: z.number().finite().nonnegative().nullable(),
  remaining_g: z.number().finite().nonnegative().nullable(),
  status: z.enum(['WAITING_APPROVAL', 'PARTIAL_WAITING_APPROVAL', 'REQUIRES_REVIEW', 'COMPLETED']),
  review_reasons: z.array(z.string().min(1)),
  approval_count: z.number().int().nonnegative(),
  can_dispatch: z.literal(false),
}).strict();
export type AiHstProposal = z.infer<typeof aiHstProposalSchema>;

export const aiHstProposalsSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['READY', 'NO_SCHEDULE']),
  proposals: z.array(aiHstProposalSchema),
  can_dispatch: z.literal(false),
}).strict();
export type AiHstProposals = z.infer<typeof aiHstProposalsSchema>;

/** Browser request. Node API obtains actor from its authenticated session;
 * client is not allowed to select or impersonate the operator.
 */
export const aiHstApprovalRequestSchema = z.object({
  obligationId: z.string().regex(/^[a-f0-9]{64}$/),
  approvalId: z.string().uuid(),
  expectedRemainingG: z.number().finite().positive(),
  confirmation: z.literal('REVIEW_HST_SHADOW_SESSION'),
}).strict();
export type AiHstApprovalRequest = z.infer<typeof aiHstApprovalRequestSchema>;

export const aiHstApprovalResultSchema = z.object({
  schemaVersion: z.literal(1),
  approval_id: z.string().uuid(),
  obligation_id: z.string().regex(/^[a-f0-9]{64}$/),
  operator_id: z.string().min(1).max(128),
  approved_at: z.string().datetime({ offset: true }),
  approval_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_remaining_g: z.number().finite().positive(),
  status: z.literal('SHADOW_REVIEW_BLOCKED'),
  can_dispatch: z.literal(false),
  command_created: z.literal(false),
  dispatch_status: z.literal('NOT_DISPATCHED'),
  hold_reasons: z.array(z.string().min(1)),
  sensor_evidence: z.object({
    message_id: z.string().nullable(),
    recorded_at: z.string().nullable(),
    water_tank_pct: z.number().finite().nullable(),
    fertilizer_tank_pct: z.number().finite().nullable(),
    soil_2_moisture_pct: z.number().finite().nullable(),
    water_valid: z.boolean(),
    fertilizer_valid: z.boolean(),
    soil_2_valid: z.boolean(),
    device_mode: z.string().nullable(),
    device_recorded_at: z.string().nullable(),
  }).strict(),
  plan: z.record(z.string(), z.unknown()).nullable(),
}).strict();
export type AiHstApprovalResult = z.infer<typeof aiHstApprovalResultSchema>;

/** Read-only mode readiness. HST TEST_REAL deliberately cannot dispatch until
 * an independently verified firmware volume-session integration is installed. */
export const aiHstExecutionReadinessSchema = z.object({
  schemaVersion: z.literal(1),
  runningMode: z.literal('SHADOW_MODE'),
  realTest: z.object({
    ready: z.literal(false),
    blockers: z.array(z.string().min(1)),
  }).strict(),
  canDispatch: z.literal(false),
}).strict();
export type AiHstExecutionReadiness = z.infer<typeof aiHstExecutionReadinessSchema>;

/** Non-actuating, per-obligation inspection for eventual physical HST sessions.
 * It cannot grant execution authority by construction. */
export const aiHstRealPreflightSchema=z.object({
 schemaVersion:z.literal(1),
 obligationId:z.string().regex(/^[a-f0-9]{64}$/),
 status:z.literal('BLOCKED'),
 reasons:z.array(z.string().min(1)),
 canDispatch:z.literal(false),
}).strict();
export type AiHstRealPreflight=z.infer<typeof aiHstRealPreflightSchema>;

/** Physical execution is separately authorized; a SHADOW review is only AI
 * calculation evidence. The browser never submits actuator parameters. */
export const aiHstHardwareProfileSchema=z.object({
 programId:z.string().uuid(),activityId:z.string().regex(/^row-\d+$/),sourceRow:z.number().int().positive(),
 deviceId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
 product:z.string().trim().min(1),
 programRevision:z.number().int().positive(),ecProfileRevision:z.number().int().positive(),
 stockConcentrationGPerL:z.number().finite().positive().max(1000),
 waterMeterPosition:z.enum(['before_injector','after_injector']),
 hydraulicsReference:z.string().trim().min(10).max(1000),
 ecToleranceUs:z.number().finite().min(20).max(500),
 maxDurationSec:z.number().int().min(60).max(7200),
 flushDurationSec:z.number().int().min(10).max(600),
}).strict();
export type AiHstHardwareProfile=z.infer<typeof aiHstHardwareProfileSchema>;

export const aiHstRealExecuteRequestSchema=z.object({
 obligationId:z.string().regex(/^[a-f0-9]{64}$/),
 approvalId:z.string().uuid(),
 expectedRemainingG:z.number().finite().positive(),
 confirmation:z.literal('EXECUTE_HST_REAL_ADAPTIVE_SESSION'),
}).strict();
export type AiHstRealExecuteRequest=z.infer<typeof aiHstRealExecuteRequestSchema>;

export const aiHstRealPlanSchema=z.object({
 water_l:z.number().finite().positive(),
 stock_l:z.number().finite().positive(),
 mass_g:z.number().finite().positive(),
 duration_seconds:z.number().finite().positive(),
 priming_water_l:z.number().finite().nonnegative(),
 flush_reserve_l:z.number().finite().nonnegative(),
}).strict();
export type AiHstRealPlan=z.infer<typeof aiHstRealPlanSchema>;

export const aiHstRealSessionSummarySchema=z.object({
 obligationId:z.string().regex(/^[a-f0-9]{64}$/),
 approvalId:z.string().uuid(),
 sessionId:z.string().uuid(),
 commandId:z.string().uuid(),
 status:z.enum(['queued','running','paused','completed','fault','reconciliation_required']),
 reason:z.string().nullable(),
 waterVolumeL:z.number().finite().nonnegative(),
 fertVolumeL:z.number().finite().nonnegative(),
 commandedWaterL:z.number().finite().positive(),
 commandedFertL:z.number().finite().positive(),
 estimatedMassG:z.number().finite().nonnegative(),
 requestedAt:z.string().datetime({offset:true}),
 lastTelemetryAt:z.string().datetime({offset:true}).nullable(),
}).strict();
export type AiHstRealSessionSummary=z.infer<typeof aiHstRealSessionSummarySchema>;
