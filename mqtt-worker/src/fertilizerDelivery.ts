export type FertilizerDeliveryInput = {
  phaseId: string;
  programId: string;
  activityId: string;
  hst: number;
  product: string;
  targetG: number | null;
  startedAt: Date | null;
  previousDeliveredG: number | null;
  baseline: Record<string, unknown> | null;
  telemetry: {
    recorded_at: Date; flow_fert_total_l: number | null; flow_water_total_l: number | null;
    flow_fert_lpm: number | null; flow_water_lpm: number | null;
    sensor_health: Record<string, unknown>; raw_payload: Record<string, unknown>;
  } | null;
  deviceStatus: { recorded_at: Date; mode: string; raw_payload: Record<string, unknown> } | null;
};

/** Extension point: return TOTAL grams delivered for this phase, not a per-tick increment.
 * Return null until the operator's formula can calculate a value from valid evidence.
 * Repeated calls for the same telemetry must return the same total.
 */
export function calculateDeliveredFertilizerGrams(_input: FertilizerDeliveryInput): number | null {
  // Operator-provided formula belongs here. No default flow/concentration conversion.
  return null;
}

export function fertilizerProgress(targetG: number | null, deliveredG: number | null) {
  const known = targetG !== null && Number.isFinite(targetG) && targetG >= 0 &&
    deliveredG !== null && Number.isFinite(deliveredG) && deliveredG >= 0;
  return { remainingG: known ? Math.max(0, targetG! - deliveredG!) : null,
    fulfilled: known && deliveredG! >= targetG! };
}
