import {
  aiDispatchReadinessSchema,
  type AiDispatchBlocker,
  type AiDispatchReadiness,
  type UnifiedAiDashboard,
} from '@spff/contracts';

/**
 * Intentionally pure and advisory. No DB writes, MQTT, command IDs, or actuators.
 * A future approved executor MUST have its own authenticated POST flow and
 * fresh DB/device interlocks; do not promote this preview to a command payload.
 */
export function assessAiDispatchReadiness(summary: UnifiedAiDashboard): AiDispatchReadiness {
  const blockers = new Set<AiDispatchBlocker>([
    'SHADOW_MODE',
    'COMMAND_EXECUTOR_NOT_IMPLEMENTED',
    'NO_CALIBRATED_HYDRAULICS',
  ]);

  if (summary.status !== 'CURRENT') blockers.add('AI_DECISION_NOT_CURRENT');
  if (summary.decision.type === 'HOLD' || summary.decision.hold_reasons.length > 0) {
    blockers.add('AI_DECISION_ON_HOLD');
  }
  if (summary.planning_source !== 'POSTGRES_READ_ONLY') {
    blockers.add('PLANNING_SOURCE_NOT_LIVE');
  }
  if (summary.planning_status !== 'CURRENT') blockers.add('PLANNING_NOT_CURRENT');
  if (summary.calculation.water_l === null || summary.calculation.duration_seconds === null) {
    blockers.add('OPERATIONAL_PLAN_MISSING');
  }
  if (!summary.decision.configuration_version) blockers.add('PROFILE_NOT_VALIDATED');
  if (summary.sensors.device_mode !== 'automatic') blockers.add('MANUAL_OPERATOR_LOCKOUT');
  if (summary.tank_preview.level_status !== 'ESTIMATED') {
    blockers.add('WATER_LEVEL_NOT_VERIFIED');
  }
  if (summary.decision.proposed_action === 'FERTIGATE' &&
      summary.fertilizer_tank_preview.level_status !== 'ESTIMATED') {
    blockers.add('STOCK_LEVEL_NOT_VERIFIED');
  }
  if (summary.feedback.status !== 'REPORTED_OFF_FRESH' ||
      summary.feedback.reported_off !== true || summary.feedback.boot_matches !== true ||
      summary.feedback.water_pump !== false || summary.feedback.fert_pump !== false) {
    blockers.add('OUTPUT_FEEDBACK_NOT_VERIFIED');
  }
  if (summary.flow_reference !== null) blockers.add('HISTORICAL_FLOW_UNVERIFIED');

  const preview = summary.planning_status === 'CURRENT' &&
      summary.fuzzy_preview_blockers.length === 0 &&
      summary.fuzzy_preview?.illustrative_water_l != null
    ? { basis: 'FUZZY_SIMULATION' as const, volumeL: summary.fuzzy_preview.illustrative_water_l }
    : null;

  return aiDispatchReadinessSchema.parse({
    schemaVersion: 1,
    stage: 'READ_ONLY_PREFLIGHT',
    canDispatch: false,
    commandCreated: false,
    sourceMode: 'SHADOW_MODE',
    decisionStatus: summary.status,
    planningStatus: summary.planning_status,
    proposedAction: summary.decision.proposed_action,
    decisionEvaluatedAt: summary.evaluated_at,
    planningRecordedAt: summary.planning_recorded_at,
    illustrativeWater: preview,
    sourceHoldReasons: summary.decision.hold_reasons,
    blockers: [...blockers],
  });
}
