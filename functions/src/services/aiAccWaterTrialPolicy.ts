import type { AiAccWaterTrialRequest, UnifiedAiDashboard } from '@spff/contracts';

export class AiAccWaterTrialBlocked extends Error {}

function block(message: string): never { throw new AiAccWaterTrialBlocked(message); }

export function freshTimestamp(value: unknown, at: Date, maxAgeMs: number): boolean {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  const age = at.getTime() - time;
  return Number.isFinite(age) && age >= -5000 && age <= maxAgeMs;
}

/**
 * Preflight never turns the Fuzzy "SIMULATION_PROFILE" preview into a pump
 * target. Only the real operational water_l field may bound a supervised
 * water-only experiment, and every source is checked against the operator's
 * exact reviewed snapshot.
 */
export function planAiAccWaterTrial(
  source: UnifiedAiDashboard,
  input: AiAccWaterTrialRequest,
  now: Date = new Date(),
) {
  if (source.status !== 'CURRENT' ||
      source.decision.type === 'HOLD' ||
      source.decision.hold_reasons.length !== 0 ||
      source.decision.proposed_action !== input.expectedAction ||
      source.evaluated_at !== input.expectedEvaluatedAt ||
      !freshTimestamp(source.evaluated_at, now, 30000)) {
    block('Keputusan AI tidak fresh atau berubah sejak diperiksa operator.');
  }
  if (source.planning_source !== 'POSTGRES_READ_ONLY' ||
      source.planning_status !== 'CURRENT' ||
      !freshTimestamp(source.planning_recorded_at, now, 45000) ||
      !freshTimestamp(source.sensors.recorded_at, now, 45000)) {
    block('Data sumber AI tidak cukup terbaru untuk trial.');
  }
  if (source.sensors.device_mode !== 'automatic') {
    block('AI ACC hanya berlaku untuk ESP32 Automatic.');
  }
  const sourceKey = source.sensors.control_moisture_source;
  const soilValid = sourceKey === 'soil_1_moisture' ? source.sensors.soil_1_valid :
    sourceKey === 'soil_2_moisture' ? source.sensors.soil_2_valid : false;
  if (!soilValid || source.fuzzy_preview_blockers.length !== 0) {
    block('Sensor kendali AI belum tervalidasi.');
  }
  if (source.tank_preview.sensor_valid !== true ||
      source.tank_preview.reported_level_pct === null ||
      source.tank_preview.reported_level_pct <= 0) {
    block('Level tandon belum terbukti tersedia.');
  }
  if (source.feedback.status !== 'REPORTED_OFF_FRESH' ||
      !source.feedback.reported_off || !source.feedback.boot_matches ||
      source.feedback.water_pump !== false ||
      source.feedback.fert_pump !== false ||
      !freshTimestamp(source.feedback.reported_at, now, 45000)) {
    block('Kedua output OFF dan boot perangkat belum terbukti fresh.');
  }
  if (source.flow_reference !== null) {
    block('Referensi flow historis belum boleh dipakai sebagai batas fisik.');
  }
  const plannedWaterL = source.calculation.water_l;
  if (plannedWaterL === null || !Number.isFinite(plannedWaterL) || plannedWaterL < 1) {
    block('Belum ada perhitungan liter operasional yang valid; Fuzzy simulasi tidak boleh dipakai.');
  }
  const segmentL = Math.floor(Math.min(plannedWaterL, input.trialCapL) * 1000) / 1000;
  if (segmentL < 1 || segmentL > 5) block('Volume trial di luar batas staging.');
  return {
    targetWaterL: segmentL,
    durationSec: input.durationSec,
    evaluatedAt: source.evaluated_at,
    plannedWaterL,
    expectedAction: input.expectedAction,
  };
}
