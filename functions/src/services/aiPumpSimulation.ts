import {
  aiPumpSimulationSchema,
  type AiPumpSimulation,
  type UnifiedAiDashboard,
} from '@spff/contracts';
import { assessAiDispatchReadiness } from './aiDispatchReadiness.js';

/**
 * Maps current real-sensor Fuzzy SHADOW output into an INERT protocol trial sample.
 * This is not a calibrated agronomic plan and must not be inserted into
 * spff.control_commands. A fixed 60s timebox is for contract testing ONLY;
 * it is never calculated from the unverified historical LPM.
 */
export function prepareAiPumpSimulation(summary: UnifiedAiDashboard): AiPumpSimulation {
  const mockBlockers: AiPumpSimulation['mockBlockers'] = [];
  const fuzzy = summary.fuzzy_preview;
  const water = fuzzy?.illustrative_water_l;
  if (!fuzzy || water === null || water === undefined) {
    mockBlockers.push('FUZZY_PREVIEW_MISSING');
  }
  if (summary.planning_status !== 'CURRENT') {
    mockBlockers.push('PLANNING_NOT_CURRENT');
  }
  if (summary.planning_source !== 'POSTGRES_READ_ONLY') {
    mockBlockers.push('PLANNING_SOURCE_NOT_LIVE');
  }
  if (summary.fuzzy_preview_blockers.length > 0) {
    mockBlockers.push('FUZZY_SENSOR_BLOCKED');
  }
  if (!fuzzy?.recorded_at || fuzzy.recorded_at !== summary.planning_recorded_at) {
    mockBlockers.push('SOURCE_SNAPSHOT_MISMATCH');
  }
  if (water !== null && water !== undefined && (!Number.isFinite(water) || water < 1)) {
    mockBlockers.push('FUZZY_VOLUME_TOO_SMALL');
  }

  // The contract's physical water-trial envelope is 1..100L and 5..60s.
  // The mock uses the first 100L maximum as a protocol clip, NOT a physical
  // instruction. Any deferred volume is never queued or automatically retried.
  const roundedTarget = water == null ? null
    : Math.round(Math.min(water, 100) * 100) / 100;
  const candidate = mockBlockers.length === 0 && roundedTarget !== null
    ? {
      targetWaterL: roundedTarget,
      deferredWaterL: Math.max(0, Math.round((water! - roundedTarget) * 100) / 100),
      durationSec: 60 as const,
      durationBasis: 'FIXED_MOCK_TIMEBOX_NOT_HYDRAULIC' as const,
      targetId: 'pump_water' as const,
    }
    : null;

  return aiPumpSimulationSchema.parse({
    schemaVersion: 1,
    stage: 'AI_PUMP_PROTOCOL_SIMULATION',
    simulationOnly: true,
    canDispatch: false,
    commandCreated: false,
    mqttPublished: false,
    physicalAckReceived: false,
    source: {
      basis: 'FUZZY_SIMULATION',
      recordedAt: fuzzy?.recorded_at ?? null,
      inputKey: fuzzy?.input_key ?? null,
      illustrativeWaterL: water ?? null,
      decisionStatus: summary.status,
      planningStatus: summary.planning_status,
      proposedAction: summary.decision.proposed_action,
    },
    mockCandidate: candidate,
    mockBlockers,
    dispatchBlockers: assessAiDispatchReadiness(summary).blockers,
    deviceCommandStatus: 'NOT_SENT',
  });
}
