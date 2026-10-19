/**
 * Fail closed when Rule-Based telemetry health is missing or not explicitly valid.
 *
 * Numeric presence alone is not sensor health. These values are guardrails against
 * obviously corrupt readings, not a replacement for hardware calibration.
 */
type SensorHealthMap = Record<string, { valid?: boolean } | undefined> | null | undefined;

const supportedRanges: Readonly<Record<string, readonly [number, number]>> = {
  soil_1_moisture: [0, 100],
  soil_2_moisture: [0, 100],
  liquid_ec_us_cm: [0, 100000],
  flow_water_lpm: [0, 10000],
  flow_fert_lpm: [0, 10000],
  tank_water_level_pct: [0, 100],
  tank_fert_level_pct: [0, 100],
};

export function isVerifiedFertigationReading(
  key: string,
  value: number | null,
  sensorHealth: SensorHealthMap,
): boolean {
  const range = supportedRanges[key];
  return range !== undefined &&
    sensorHealth?.[key]?.valid === true &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range[0] &&
    value <= range[1];
}
