import {
  aiCommandPreparationSchema,
  type AiCommandPreparation,
  type AiPreparationGate,
  type UnifiedAiDashboard,
} from '@spff/contracts';
import { assessAiDispatchReadiness } from './aiDispatchReadiness.js';

const requiredGates: AiPreparationGate[] = [
  'DEVICE_IDENTITY_NOT_BOUND',
  'ACTUATOR_TARGET_NOT_BOUND',
  'CALIBRATED_PARAMETERS_NOT_AVAILABLE',
  'FIRMWARE_SESSION_PROTOCOL_NOT_VERIFIED',
  'INTERLOCK_AND_STATE_NOT_REVALIDATED',
  'SCHEDULE_AND_QUEUE_CONFLICTS_NOT_CHECKED',
  'OPERATOR_APPROVAL_NOT_REQUESTED',
];

/** Deterministic, pure, non-actuating projection: no writes, MQTT, or command IDs.
 * Only the caller creates a disposable previewId and date; not an approval token.
 */
export function prepareAiCommandPreview(
  summary: UnifiedAiDashboard,
  previewId: string,
  now: Date,
): AiCommandPreparation {
  const action = summary.decision.proposed_action;
  const intent = action === null
    ? 'NO_DECISION'
    : action === 'IRRIGATE' || action === 'FERTIGATE' || action === 'OFF'
      ? action
      : 'UNMAPPED';

  return aiCommandPreparationSchema.parse({
    schemaVersion: 1,
    stage: 'NON_EXECUTABLE_PREPARATION',
    status: 'BLOCKED',
    sourceMode: 'SHADOW_MODE',
    canDispatch: false,
    commandCreated: false,
    approvalStatus: 'NOT_REQUESTED',
    previewId,
    preparedAt: now.toISOString(),
    previewExpiresAt: new Date(now.getTime() + 120_000).toISOString(),
    intent,
    readiness: assessAiDispatchReadiness(summary),
    gates: [...requiredGates],
    command: {
      commandId: null, issuedAt: null, expiresAt: null, requestedBy: null,
      siteId: null, deviceId: null, targetId: null, type: null, params: null,
    },
    executablePayload: null,
  });
}
