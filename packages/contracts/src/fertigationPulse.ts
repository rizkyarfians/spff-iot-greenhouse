import { z } from 'zod';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const finite = z.number().finite();
const ms = z.number().int().positive();
const identity = { schemaVersion: z.literal(1), siteId: id, deviceId: id,
  sessionId: z.string().uuid(), commandId: z.string().uuid(), cycle: z.number().int().min(1).max(1000),
  issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }) };
export const fertigationPulseSchema = z.object({
  ...identity, bootId: z.string().regex(/^[a-fA-F0-9]{16}$/), kind: z.literal('fertigation_pulse'), targetId: z.literal('pump_fert'),
  params: z.object({ onDurationMs: ms.min(1500).max(30000), waterWithPulse: z.boolean(),
    minFlowLpm: finite.positive().max(10000),
    flowSensorKey: z.enum(['flow_water_lpm', 'flow_fert_lpm']) }).strict(),
}).strict().refine(v => Date.parse(v.expiresAt) > Date.parse(v.issuedAt) &&
  Date.parse(v.expiresAt) - Date.parse(v.issuedAt) <= 30000, 'Invalid command lifetime');
export const fertigationPulseStopSchema = z.object({ ...identity, kind: z.literal('fertigation_pulse_stop') }).strict();
export const fertigationPulseReleaseSchema = z.object({ ...identity, kind: z.literal('fertigation_pulse_release'), resumeAutomatic: z.literal(true).optional() }).strict();
export const fertigationPulseCommandSchema = z.union([fertigationPulseSchema, fertigationPulseStopSchema, fertigationPulseReleaseSchema]);
export type FertigationPulse = z.infer<typeof fertigationPulseSchema>;
export type FertigationPulseCommand = z.infer<typeof fertigationPulseCommandSchema>;
export const fertigationPulseAckSchema = z.object({ kind: z.literal('fertigation_pulse_ack'),
  schemaVersion: z.literal(1), siteId: id, deviceId: id, sessionId: z.string().uuid(),
  commandId: z.string().uuid(), cycle: z.number().int().min(1).max(1000),
  status: z.enum(['accepted', 'completed', 'rejected', 'fault']),
  acknowledgedAt: z.string().datetime({ offset: true }), pumpsOff: z.boolean(),
  reason: z.string().min(1).max(200),
}).strict().refine(v => v.status !== 'completed' || v.pumpsOff, 'Completed requires OFF readback');
export type FertigationPulseAck = z.infer<typeof fertigationPulseAckSchema>;
export const isFertigationPulseCommand = (v: unknown): v is FertigationPulseCommand => fertigationPulseCommandSchema.safeParse(v).success;
export const isFertigationPulseAck = (v: unknown): v is FertigationPulseAck => fertigationPulseAckSchema.safeParse(v).success;

// No calibration defaults: operators must provide measured equipment/site values.
export const soilEcPulseProfileSchema = z.object({
  calibrationReference: z.string().trim().min(5).max(500),
  soilEcTargetsVerified: z.literal(true), hydraulicsVerified: z.literal(true),
  kpMsPerUsCm: finite.positive().max(1000), minOnMs: ms.min(1500).max(30000), maxOnMs: ms.max(30000),
  settleMs: ms.min(1000).max(86400000), maxSessionMs: ms.max(86400000),
  maxTotalOnMs: ms.max(3600000), maxDailyOnMs: ms.max(3600000),
  maxCycles: z.number().int().min(1).max(1000),
  stableSamples: z.number().int().min(2).max(10),
  stableSpreadUsCm: finite.nonnegative().max(10000),
  toleranceUsCm: finite.nonnegative().max(10000),
  minimumRiseUsCm: finite.nonnegative().max(10000),
  maxNoResponseCycles: z.number().int().min(1).max(20),
  moistureMinPercent: finite.min(0).max(100), moistureMaxPercent: finite.min(0).max(100),
  cooldownMs: ms.max(604800000), waterWithPulse: z.boolean(),
  flowSensorKey: z.enum(['flow_water_lpm', 'flow_fert_lpm']), minFlowLpm: finite.positive().max(10000),
}).strict().refine(v => v.minOnMs <= v.maxOnMs && v.maxOnMs <= v.maxTotalOnMs &&
  v.maxTotalOnMs <= v.maxDailyOnMs && v.moistureMinPercent < v.moistureMaxPercent &&
  v.settleMs < v.maxSessionMs, 'Inconsistent pulse limits');
export type SoilEcPulseProfile = z.infer<typeof soilEcPulseProfileSchema>;
export const startSoilEcSessionSchema = z.object({ deviceId: id, recipeId: z.string().uuid(),
  requestId: z.string().uuid(), profile: soilEcPulseProfileSchema }).strict();

export type StartSoilEcSession = z.infer<typeof startSoilEcSessionSchema>;

export function soilEcPulseDuration(errorUsCm: number, profile: SoilEcPulseProfile): number {
  if (!Number.isFinite(errorUsCm) || errorUsCm <= profile.toleranceUsCm) return 0;
  return Math.min(profile.maxOnMs, Math.max(profile.minOnMs, Math.round(profile.kpMsPerUsCm * errorUsCm)));
}
export interface SoilEcSample { recordedAt: string; ec: number | null; moisture: number | null; valid: boolean }
export type SoilEcDecision = { action: 'wait' | 'complete' | 'fault' | 'pulse'; reason: string; ec?: number; onMs?: number };
export function decideSoilEcPulse(input: {
  nowMs: number; afterMs: number; samples: SoilEcSample[]; target: number; high: number;
  startLow: number; cycles: number; totalOnMs: number; dailyOnMs: number;
  previousEc: number | null; noResponseCycles: number; profile: SoilEcPulseProfile;
}): SoilEcDecision {
  const { profile: p, nowMs } = input;
  const samples = [...new Map(input.samples.map(s => [s.recordedAt, s])).values()]
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const latest = samples[0];
  if (!latest || !latest.valid || !Number.isFinite(latest.ec) || !Number.isFinite(latest.moisture) ||
      Date.parse(latest.recordedAt) > nowMs || nowMs - Date.parse(latest.recordedAt) > 120000)
    return { action: 'fault', reason: 'soil_sensor_invalid_or_stale' };
  if (latest.moisture! < p.moistureMinPercent || latest.moisture! > p.moistureMaxPercent)
    return { action: 'fault', reason: 'moisture_outside_calibrated_range' };
  if (latest.ec! >= input.high) return { action: 'fault', reason: 'soil_ec_high' };
  if (nowMs < input.afterMs) return { action: 'wait', reason: 'settling' };
  const stable = samples.filter(s => Date.parse(s.recordedAt) > input.afterMs).slice(0, p.stableSamples);
  if (stable.length < p.stableSamples) return { action: 'wait', reason: 'waiting_new_samples' };
  if (stable.some(s => !s.valid || s.ec === null || s.moisture === null ||
      s.ec >= input.high || s.moisture < p.moistureMinPercent || s.moisture > p.moistureMaxPercent ||
      nowMs - Date.parse(s.recordedAt) > 120000)) return { action: 'fault', reason: 'invalid_confirmation_samples' };
  const values = stable.map(s => s.ec!);
  if (Math.max(...values) - Math.min(...values) > p.stableSpreadUsCm)
    return { action: 'wait', reason: 'soil_ec_unstable' };
  const ec = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.every(v => Math.abs(v - input.target) <= p.toleranceUsCm))
    return { action: 'complete', reason: 'soil_ec_target_stable', ec };
  if (Math.abs(ec-input.target) <= p.toleranceUsCm) return { action:'wait',reason:'target_confirmation',ec };
  if (ec > input.target + p.toleranceUsCm) return { action: 'fault', reason: 'soil_ec_overshoot', ec };
  if (input.cycles === 0 && values.some(v => v > input.startLow))
    return { action: 'wait', reason: 'soil_ec_above_start_threshold', ec };
  if (input.previousEc !== null && ec < input.previousEc - p.stableSpreadUsCm)
    return { action: 'fault', reason: 'unexpected_soil_ec_decrease', ec };
  if (input.previousEc !== null && ec - input.previousEc < p.minimumRiseUsCm &&
      input.noResponseCycles + 1 >= p.maxNoResponseCycles)
    return { action: 'fault', reason: 'soil_ec_no_response', ec };
  const onMs = soilEcPulseDuration(input.target - ec, p);
  if (input.cycles >= p.maxCycles || input.totalOnMs + onMs > p.maxTotalOnMs ||
      input.dailyOnMs + onMs > p.maxDailyOnMs) return { action: 'fault', reason: 'pulse_budget_limit', ec };
  return { action: 'pulse', reason: 'soil_ec_below_target', ec, onMs };
}
