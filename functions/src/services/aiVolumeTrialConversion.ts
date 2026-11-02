import {
  aiVolumeTrialPreviewInputSchema,
  aiVolumeTrialPreviewSchema,
  type AiVolumeTrialPreview,
  type AiVolumeTrialPreviewInput,
  type UnifiedAiDashboard,
} from '@spff/contracts';

export class AiVolumeTrialPreviewBlocked extends Error {
  constructor(public readonly reason: string) {
    super('Konversi AI ke kandidat trial ditolak: ' + reason);
  }
}

function block(reason: string): never {
  throw new AiVolumeTrialPreviewBlocked(reason);
}

/**
 * Conversion from a real fresh SHADOW Fuzzy preview into a bounded software
 * candidate. This function has NO database, MQTT, command, or hardware side effects.
 * In particular, it does not convert historical LPM into pump runtime.
 */
export function convertAiFuzzyToSoftwareTrial(
  summary: UnifiedAiDashboard,
  requested: AiVolumeTrialPreviewInput,
  now: Date = new Date(),
): AiVolumeTrialPreview {
  const input = aiVolumeTrialPreviewInputSchema.parse(requested);
  if (summary.mode !== 'SHADOW_MODE' || summary.can_dispatch !== false) {
    block('AI harus dalam SHADOW_MODE.');
  }
  if (summary.planning_source !== 'POSTGRES_READ_ONLY' ||
      summary.planning_status !== 'CURRENT') {
    block('Snapshot telemetry PostgreSQL belum CURRENT.');
  }
  if (summary.fuzzy_preview_blockers.length > 0) {
    block('Sensor atau konfigurasi Fuzzy preview tidak memenuhi syarat.');
  }
  const preview = summary.fuzzy_preview;
  if (!preview || preview.basis !== 'SIMULATION_PROFILE' ||
      preview.illustrative_water_l === null || preview.score === null ||
      preview.recorded_at === null ||
      preview.illustrative_water_l < 1 ||
      preview.illustrative_water_l > (preview.model_max_irrigation_l ?? 0) ||
      preview.score < 0 || preview.score > 1) {
    block('Hasil volume Fuzzy SHADOW tidak valid.');
  }
  if (summary.planning_recorded_at !== preview.recorded_at ||
      summary.sensors.recorded_at !== preview.recorded_at ||
      summary.sensors.control_moisture_source !== preview.input_key) {
    block('Bukti sensor dan preview Fuzzy tidak cocok.');
  }
  const timestamp = Date.parse(preview.recorded_at);
  const age = now.getTime() - timestamp;
  if (!Number.isFinite(age) || age < -5000 || age > 120000) {
    block('Sensor Fuzzy lebih dari dua menit atau waktu tidak valid.');
  }

  // Floor instead of round to prevent exceeding the operator's bounded cap.
  const target = Math.floor(Math.min(preview.illustrative_water_l, input.trialCapL) * 1000) / 1000;
  if (!Number.isFinite(target) || target < 1) block('Volume trial di bawah minimum 1 liter.');

  return aiVolumeTrialPreviewSchema.parse({
    schemaVersion: 1,
    stage: 'SIMULATION_ONLY',
    canDispatch: false,
    commandCreated: false,
    mqttPublished: false,
    operatorApprovalRequired: true,
    source: {
      basis: 'FUZZY_SIMULATION',
      configVersion: preview.config_version,
      recordedAt: preview.recorded_at,
      soilSensorKey: preview.input_key,
      moisturePct: preview.moisture_pct,
      fuzzyScore: preview.score,
      illustrativeWaterL: preview.illustrative_water_l,
      decisionStatus: summary.status,
      proposedAction: summary.decision.proposed_action,
    },
    conversion: {
      strategy: 'CAP_BY_OPERATOR_TEST_LIMIT',
      operatorCapL: input.trialCapL,
      targetWaterL: target,
      capped: target < preview.illustrative_water_l,
      durationSec: input.durationSec,
      durationBasis: 'OPERATOR_MAX_TIMEOUT_NOT_ESTIMATED_FLOW',
    },
    commandCandidate: {
      deviceId: input.deviceId,
      targetId: 'pump_water',
      params: {
        isActive: true,
        waterTrial: { targetWaterL: target, durationSec: input.durationSec },
      },
    },
  });
}
