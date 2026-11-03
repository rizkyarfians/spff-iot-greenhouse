import { z } from 'zod';

// Orthogonal to ESP32's physical Manual / Automatic selector.
// LIVE is a supervised water-only ACC path, never autonomous irrigation.
export const aiExecutionModeSchema = z.enum(['off', 'shadow', 'live']);
export type AiExecutionMode = z.infer<typeof aiExecutionModeSchema>;

export const aiExecutionModeUpdateSchema = z.object({
  deviceId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  mode: aiExecutionModeSchema,
  expectedRevision: z.number().int().nonnegative(),
  confirmation: z.enum(['CHANGE_AI_MODE', 'ENABLE_AI_LIVE_SUPERVISED']),
}).strict();
export type AiExecutionModeUpdate = z.infer<typeof aiExecutionModeUpdateSchema>;

export const aiExecutionModeStateSchema = z.object({
  deviceId: z.string().min(1).max(80),
  mode: aiExecutionModeSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  updatedBy: z.string().nullable(),
  liveSelectable: z.boolean(),
  workerDispatchConfirmed: z.literal(false),
}).strict();
export type AiExecutionModeState = z.infer<typeof aiExecutionModeStateSchema>;
