import { fertigationPulseSchema } from './fertigationPulse.js';

const duration = fertigationPulseSchema.shape.params.shape.onDurationMs;
const minimumMs = duration.minValue!;
const maximumMs = duration.maxValue!;

export type HstStockReading = {
  recordedAtMs: number;
  bootId: string;
  totalL: number;
  valid: boolean;
};

export function planHstDosePulse(remainingG: number, concentrationGPerL: number, maxStockFlowLpm: number) {
  if (!Number.isFinite(remainingG) || remainingG < 0 ||
      !Number.isFinite(concentrationGPerL) || concentrationGPerL <= 0 ||
      !Number.isFinite(maxStockFlowLpm) || maxStockFlowLpm <= 0) {
    throw new RangeError('HST pulse requires a valid remaining dose, concentration and maximum stock flow.');
  }
  const budgetMs = Math.floor(remainingG / concentrationGPerL / maxStockFlowLpm * 60_000);
  if (budgetMs < minimumMs) return null;
  return { onDurationMs: Math.min(budgetMs, maximumMs), waterWithPulse: true as const };
}

/** Returns measured delivery only after two distinct, matching post-OFF readings. */
export function measureHstDosePulse(input: {
  before: HstStockReading;
  after: readonly [HstStockReading, HstStockReading];
  startedAtMs: number;
  pumpsOffAtMs: number;
  concentrationGPerL: number;
}) {
  const { before, after: [first, second], startedAtMs, pumpsOffAtMs, concentrationGPerL } = input;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(pumpsOffAtMs) ||
      !Number.isFinite(concentrationGPerL) || concentrationGPerL <= 0 ||
      !before.bootId || ![before, first, second].every(reading =>
        reading.valid && reading.bootId === before.bootId && Number.isFinite(reading.recordedAtMs) &&
        Number.isFinite(reading.totalL) && reading.totalL >= 0)) return null;
  if (before.recordedAtMs > startedAtMs || startedAtMs >= pumpsOffAtMs ||
      first.recordedAtMs <= pumpsOffAtMs || second.recordedAtMs <= first.recordedAtMs ||
      first.totalL < before.totalL || first.totalL !== second.totalL) return null;
  const stockL = second.totalL - before.totalL;
  const deliveredG = stockL * concentrationGPerL;
  return Number.isFinite(deliveredG) ? { stockL, deliveredG } : null;
}
