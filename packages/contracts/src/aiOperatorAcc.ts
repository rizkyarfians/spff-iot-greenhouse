import { z } from 'zod';

/** Operator ACC staging: verifies a reviewed AI decision, never actuates. */
export const aiOperatorAccRequestSchema = z.object({
  expectedAction: z.enum(['IRRIGATE', 'FERTIGATE']),
  expectedEvaluatedAt: z.string().datetime({ offset: true }),
  confirmation: z.literal('CHECK_OPERATOR_ACC_DRY_RUN'),
}).strict();

export type AiOperatorAccRequest = z.infer<typeof aiOperatorAccRequestSchema>;

export const aiOperatorAccResultSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('OPERATOR_ACC_DRY_RUN'),
  status: z.literal('BLOCKED'),
  decisionMatched: z.boolean(),
  checkedAt: z.string().datetime({ offset: true }),
  expectedAction: z.enum(['IRRIGATE', 'FERTIGATE']),
  observedAction: z.string().nullable(),
  observedEvaluatedAt: z.string().nullable(),
  blockers: z.array(z.string().min(1).max(160)).min(1).max(40),
  operatorApprovalRecorded: z.literal(false),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  commandId: z.null(),
  mqttPublished: z.literal(false),
  actualPumpState: z.null(),
}).strict();

export type AiOperatorAccResult = z.infer<typeof aiOperatorAccResultSchema>;
