import { z } from 'zod';

const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
export const fertigationPlannerIdentitySchema = z.object({
  deviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  recipeId: z.string().uuid(),
}).strict();

/** Calibrated values for the crop/HST rule and installed hydraulic circuit. No agronomic defaults. */
export const fertigationPlannerProfileSchema = z.object({
  calibrationReference: z.string().trim().min(5).max(500),
  plantCount: z.number().int().min(1).max(1000000),
  waterLPerPlantPerMoisturePoint: positive.max(100),
  maxWaterLPerPlant: positive.max(1000),
  fertilizerGPerPlant: nonnegative.max(10000),
  calibratedWaterLpm: positive.max(10000),
  calibratedStockLpm: positive.max(10000).nullable(),
  /** Must measure stock before injection, not mixed solution/booster throughput. */
  stockFlowMeasuresInjection: z.boolean(),
  stockTankVolumeCurve: z.array(z.object({
    levelPercent: z.number().finite().min(0).max(100),
    volumeL: nonnegative.max(1000000),
  }).strict()).min(2).max(30),
  stockReserveL: nonnegative.max(100000),
  maxDailyStockL: nonnegative.max(100000),
  stabilizationSeconds: positive.max(3600),
  flushWaterL: positive.max(100000),
  mixingSeconds: positive.max(3600),
  ecKpMsPerUsCm: positive.max(10000),
  minPulseMs: z.number().int().min(1500).max(30000),
  maxPulseMs: z.number().int().min(1500).max(30000),
}).strict().superRefine((value, ctx) => {
  if (value.minPulseMs > value.maxPulseMs)
    ctx.addIssue({ code: 'custom', path: ['maxPulseMs'], message: 'Maximum pulse must be >= minimum.' });
  const curve = value.stockTankVolumeCurve;
  if (curve[0]?.levelPercent !== 0 || curve.at(-1)?.levelPercent !== 100 ||
      curve.some((point, i) => i > 0 && (point.levelPercent <= curve[i - 1]!.levelPercent || point.volumeL <= curve[i - 1]!.volumeL)))
    ctx.addIssue({ code: 'custom', path: ['stockTankVolumeCurve'], message: 'Calibration must span 0–100% with increasing level and volume.' });
});
export type FertigationPlannerProfile = z.infer<typeof fertigationPlannerProfileSchema>;
export const fertigationPlannerMutationSchema = fertigationPlannerIdentitySchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  expectedRecipeRevision: z.number().int().positive(),
  profile: fertigationPlannerProfileSchema,
}).strict();
