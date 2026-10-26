import { fertigationPlannerProfileSchema, type FertigationPlannerProfile, type FertigationRecipe } from '@spff/contracts';
import type { SiteEvaluationSnapshot } from './fertigationRepository.js';

export interface PlannerEvidence {
  remainingSeconds: number | null;
  dailyStockUsedL: number | null;
  holdReasons: string[];
}

export function stockVolumeAtLevel(profile: FertigationPlannerProfile, percent: number): number {
  const curve = profile.stockTankVolumeCurve;
  const upper = curve.findIndex(point => point.levelPercent >= percent);
  if (upper <= 0) return curve[0]!.volumeL;
  const a = curve[upper - 1]!, b = curve[upper]!;
  return a.volumeL + (b.volumeL - a.volumeL) * (percent - a.levelPercent) / (b.levelPercent - a.levelPercent);
}

/** A fresh server plan, never a device command or proof of delivered volume. */
export function planAdaptiveFertigation(
  recipe: FertigationRecipe, snapshot: SiteEvaluationSnapshot,
  profileInput: FertigationPlannerProfile, evidence: PlannerEvidence,
) {
  const parsed = fertigationPlannerProfileSchema.safeParse(profileInput);
  const reasons = [...evidence.holdReasons];
  const base = {
    method: 'rule_based_adaptive' as const, feedback: 'liquid_ec_us_cm' as const,
    canDispatch: false as const, simulationOnly: true as const,
    executionBlockers: [
      'Firmware 1.4.30 belum menyediakan pelaksana sesi volume air–injeksi–flushing untuk planner ini.',
      'Riwayat yang tercatat belum membuktikan seluruh dosis fisik; evaluasi ini tidak mereservasi dosis.',
    ],
  };
  const hold = () => ({ ...base, status: 'hold' as const, reasons, plan: null });
  if (!parsed.success) { reasons.push('Profil kalibrasi planner tidak valid.'); return hold(); }
  const p = parsed.data;
  const finiteNonnegative = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;
  const fertilizer = recipe.targetStockL > 0;
  if (!snapshot.moistureValid || !finiteNonnegative(snapshot.moisture) || snapshot.moisture > 100 ||
      !finiteNonnegative(recipe.moistureTargetPercent) || !finiteNonnegative(recipe.moistureLowPercent) ||
      recipe.moistureTargetPercent <= recipe.moistureLowPercent || snapshot.moisture > recipe.moistureLowPercent)
    reasons.push('Kelembapan atau ambang budidaya belum memenuhi syarat planner.');
  if (!finiteNonnegative(evidence.remainingSeconds) || evidence.remainingSeconds === 0)
    reasons.push('Tidak ada sisa jendela jadwal yang tervalidasi.');
  if (!finiteNonnegative(evidence.dailyStockUsedL)) reasons.push('Pemakaian pupuk tercatat hari ini tidak dapat diverifikasi.');
  if (!Number.isFinite(recipe.targetWaterL) || recipe.targetWaterL <= 0 || !finiteNonnegative(recipe.targetStockL))
    reasons.push('Batas volume aturan tidak valid.');
  if (fertilizer) {
    if (!snapshot.liquidEcValid || !finiteNonnegative(snapshot.liquidEcUsCm) ||
        !finiteNonnegative(recipe.ecLowUsCm) || !finiteNonnegative(recipe.ecTargetUsCm) || !finiteNonnegative(recipe.ecHighUsCm) ||
        recipe.ecLowUsCm >= recipe.ecTargetUsCm || recipe.ecTargetUsCm >= recipe.ecHighUsCm ||
        snapshot.liquidEcUsCm > recipe.ecLowUsCm)
      reasons.push('EC larutan atau target aturan belum memenuhi syarat injeksi.');
    if (!p.stockFlowMeasuresInjection || p.calibratedStockLpm === null)
      reasons.push('Debit stok harus dikalibrasi pada jalur stok sebelum injeksi Venturi.');
    if (!snapshot.stockTankValid || !finiteNonnegative(snapshot.stockTankPercent) || snapshot.stockTankPercent > 100)
      reasons.push('Level tandon stok tidak valid.');
    if (!Number.isFinite(recipe.stockConcentrationGPerL) || recipe.stockConcentrationGPerL! <= 0 || p.fertilizerGPerPlant <= 0)
      reasons.push('Dosis per tanaman dan konsentrasi stok wajib terkalibrasi.');
  } else if (p.fertilizerGPerPlant !== 0) reasons.push('Aturan air saja harus memakai dosis pupuk nol.');
  if (reasons.length) return hold();

  // All water phases count against the crop water budget. Never add flushing beyond that budget.
  const waterDemandL = p.plantCount * Math.min(p.maxWaterLPerPlant,
    (recipe.moistureTargetPercent! - snapshot.moisture!) * p.waterLPerPlantPerMoisturePoint);
  const targetWaterL = Math.min(waterDemandL, recipe.targetWaterL);
  const preWaterL = fertilizer ? p.calibratedWaterLpm * p.stabilizationSeconds / 60 : 0;
  const flushWaterL = fertilizer ? p.flushWaterL : 0;
  const injectionWaterL = targetWaterL - preWaterL - flushWaterL;
  const waterSeconds = targetWaterL / p.calibratedWaterLpm * 60;
  if (targetWaterL <= 0 || (fertilizer && injectionWaterL <= 0))
    reasons.push('Anggaran air tidak cukup untuk stabilisasi, injeksi, dan flushing.');
  if (waterSeconds > evidence.remainingSeconds!) reasons.push('Kebutuhan air dan flushing melebihi sisa jendela jadwal.');

  const requestedStockL = fertilizer ? p.plantCount * p.fertilizerGPerPlant / recipe.stockConcentrationGPerL! : 0;
  const availableStockL = fertilizer ? Math.max(0, stockVolumeAtLevel(p, snapshot.stockTankPercent!) - p.stockReserveL) : 0;
  const dailyRemainingL = Math.max(0, p.maxDailyStockL - evidence.dailyStockUsedL!);
  // Never silently dilute an agronomic dose when stock/daily allowance is insufficient.
  const targetStockL = Math.min(requestedStockL, recipe.targetStockL);
  if (fertilizer && (targetStockL > availableStockL || targetStockL > dailyRemainingL))
    reasons.push('Stok tersedia atau sisa batas pupuk harian tidak mencukupi target dosis.');
  const stockOnSeconds = fertilizer ? targetStockL / p.calibratedStockLpm! * 60 : 0;
  // Conservative schedule: reserve mixing after every pulse, including the last, before flushing.
  const pulses = fertilizer ? Math.ceil(stockOnSeconds * 1000 / p.minPulseMs) : 0;
  const injectionSeconds = Math.max(0, injectionWaterL) / p.calibratedWaterLpm * 60;
  if (fertilizer && stockOnSeconds + pulses * p.mixingSeconds > injectionSeconds)
    reasons.push('Waktu injeksi tidak cukup untuk target stok beserta jeda mixing.');

  let nextPulseMs = 0;
  if (fertilizer) {
    const adaptiveMs = Math.min(p.maxPulseMs, Math.max(p.minPulseMs,
      Math.round(p.ecKpMsPerUsCm * (recipe.ecTargetUsCm! - snapshot.liquidEcUsCm!))));
    const stockBudgetMs = Math.min(targetStockL, availableStockL, dailyRemainingL) / p.calibratedStockLpm! * 60000;
    nextPulseMs = Math.floor(Math.min(adaptiveMs, stockBudgetMs, Math.max(0, injectionSeconds - p.mixingSeconds) * 1000));
    if (nextPulseMs < p.minPulseMs) reasons.push('Sisa dosis atau waktu lebih kecil dari pulse minimum terkalibrasi.');
  }
  if (reasons.length) return hold();
  return { ...base, status: 'planned' as const, reasons: ['Rencana server berdasarkan aturan tanaman/HST dan kalibrasi; belum dieksekusi.'], plan: {
    plantCount: p.plantCount, targetWaterL, targetStockL, requestedStockL,
    stockDoseCapped: targetStockL < requestedStockL, fertilizerMassG: fertilizer ? targetStockL * recipe.stockConcentrationGPerL! : 0,
    availableStockL, recordedDailyStockUsedL: evidence.dailyStockUsedL!, dailyRemainingL,
    waterPumpSeconds: waterSeconds, fertilizerPumpOnSeconds: stockOnSeconds,
    remainingScheduleSeconds: evidence.remainingSeconds!, nextPulseMs,
    flowBasis: 'calibrated_estimate' as const,
    phases: fertilizer ? [
      { phase: 'stabilize', waterL: preWaterL, seconds: p.stabilizationSeconds },
      { phase: 'inject_and_mix', waterL: injectionWaterL, seconds: injectionSeconds },
      { phase: 'flush', waterL: flushWaterL, seconds: flushWaterL / p.calibratedWaterLpm * 60 },
    ] : [{ phase: 'irrigate', waterL: targetWaterL, seconds: waterSeconds }],
  } };
}
