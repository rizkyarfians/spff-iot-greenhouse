import { z } from 'zod';

/** Manually approved calibration trial: never auto-start from Fuzzy SHADOW. */
export const waterTrialRequestSchema = z.object({
  deviceId: z.string().min(1).max(80),
  commandId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
  targetWaterL: z.number().finite().min(1).max(100),
  durationSec: z.number().int().min(5).max(60),
  confirmation: z.literal('RUN_CALIBRATION_TRIAL'),
}).strict();
export type WaterTrialRequest = z.infer<typeof waterTrialRequestSchema>;

/** Operator measured volume independently using a physical reference vessel. */
export const waterTrialCalibrationSchema = z.object({
  physicalMeasuredL: z.number().finite().positive().max(10000),
  note: z.string().max(500).default(''),
}).strict();
export type WaterTrialCalibration = z.infer<typeof waterTrialCalibrationSchema>;
