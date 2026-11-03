/** Non-executable AI intent preparation for a future operator-approved command flow.
 * Intentionally cannot contain a PumpCommandMessage, target, dose, or commandId.
 */
import { z } from 'zod';
import { aiDispatchReadinessSchema } from './aiDispatchReadiness.js';

export const aiPreparationGateSchema = z.enum([
  'DEVICE_IDENTITY_NOT_BOUND',
  'ACTUATOR_TARGET_NOT_BOUND',
  'CALIBRATED_PARAMETERS_NOT_AVAILABLE',
  'FIRMWARE_SESSION_PROTOCOL_NOT_VERIFIED',
  'INTERLOCK_AND_STATE_NOT_REVALIDATED',
  'SCHEDULE_AND_QUEUE_CONFLICTS_NOT_CHECKED',
  'OPERATOR_APPROVAL_NOT_REQUESTED',
]);
export type AiPreparationGate = z.infer<typeof aiPreparationGateSchema>;

const emptyCommandSlot = z.object({
  commandId: z.null(),
  issuedAt: z.null(),
  expiresAt: z.null(),
  requestedBy: z.null(),
  siteId: z.null(),
  deviceId: z.null(),
  targetId: z.null(),
  type: z.null(),
  params: z.null(),
}).strict();

/** A preview ID is NOT a command ID. Expiry is for display freshness only. */
export const aiCommandPreparationSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('NON_EXECUTABLE_PREPARATION'),
  status: z.literal('BLOCKED'),
  sourceMode: z.literal('SHADOW_MODE'),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  approvalStatus: z.literal('NOT_REQUESTED'),
  previewId: z.string().uuid(),
  preparedAt: z.string().datetime({ offset: true }),
  previewExpiresAt: z.string().datetime({ offset: true }),
  intent: z.enum(['IRRIGATE', 'FERTIGATE', 'OFF', 'UNMAPPED', 'NO_DECISION']),
  readiness: aiDispatchReadinessSchema,
  gates: z.array(aiPreparationGateSchema).length(7),
  /** All null by contract; cannot be serialized to MQTT/DB PumpCommandMessage. */
  command: emptyCommandSlot,
  executablePayload: z.null(),
}).strict();

export type AiCommandPreparation = z.infer<typeof aiCommandPreparationSchema>;
