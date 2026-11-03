import {
  aiOperatorAccResultSchema,
  type AiOperatorAccRequest,
  type AiOperatorAccResult,
  type UnifiedAiDashboard,
} from '@spff/contracts';
import { assessAiDispatchReadiness } from './aiDispatchReadiness.js';

/** Pure staging preflight. No command, SQL mutation, MQTT, or firmware call. */
export function checkOperatorAccDryRun(
  source: UnifiedAiDashboard,
  request: AiOperatorAccRequest,
  now: Date,
): AiOperatorAccResult {
  const evaluatedAt = source.evaluated_at;
  const observedAction = source.decision.proposed_action;
  const decisionMatched =
    source.status === 'CURRENT' &&
    source.decision.type !== 'HOLD' &&
    source.decision.hold_reasons.length === 0 &&
    observedAction === request.expectedAction &&
    evaluatedAt === request.expectedEvaluatedAt;
  const blockers = new Set<string>([
    'DRY_RUN_ONLY_NO_ACTUATOR_EXECUTOR',
    'FIRMWARE_VOLUME_SESSION_NOT_VERIFIED',
    'AI_OPERATOR_ACC_DISPATCH_NOT_IMPLEMENTED',
  ]);
  if (!decisionMatched) blockers.add('REVIEWED_DECISION_CHANGED_OR_ON_HOLD');
  const age = evaluatedAt ? now.getTime() - Date.parse(evaluatedAt) : NaN;
  if (!Number.isFinite(age) || age < -5000 || age > 30000) {
    blockers.add('AI_DECISION_NOT_FRESH');
  }
  for (const reason of assessAiDispatchReadiness(source).blockers) {
    blockers.add(reason);
  }

  return aiOperatorAccResultSchema.parse({
    schemaVersion: 1,
    stage: 'OPERATOR_ACC_DRY_RUN',
    status: 'BLOCKED',
    decisionMatched,
    checkedAt: now.toISOString(),
    expectedAction: request.expectedAction,
    observedAction,
    observedEvaluatedAt: evaluatedAt,
    blockers: [...blockers],
    operatorApprovalRecorded: false,
    canDispatch: false,
    commandCreated: false,
    commandId: null,
    mqttPublished: false,
    actualPumpState: null,
  });
}
