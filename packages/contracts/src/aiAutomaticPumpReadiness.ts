import { z } from 'zod';

/** Read-only compatibility check. This can NEVER be promoted to an executable MQTT command. */
export const aiAutomaticPumpReadinessSchema = z.object({
  schemaVersion: z.literal(1),
  stage: z.literal('READ_ONLY_AUTO_COMPATIBILITY'),
  canDispatch: z.literal(false),
  commandCreated: z.literal(false),
  commandType: z.literal('set_pump'),
  targetId: z.literal('pump_water'),
  deviceId: z.string().min(1).max(80),
  sourceMode: z.literal('SHADOW_MODE'),
  actualMode: z.enum(['manual','automatic']).nullable(),
  desiredMode: z.enum(['manual','automatic']).nullable(),
  appliedMode: z.enum(['manual','automatic']).nullable(),
  firmwareVersion: z.string().nullable(),
  firmwareAutoAiOnVerified: z.literal(false),
  sourceDecisionStatus: z.enum(['CURRENT','STALE','NO_DECISION']),
  blockers: z.array(z.enum([
    'AI_SHADOW_NOT_EXECUTION_AUTHORITY',
    'AI_DECISION_NOT_CURRENT',
    'AI_DECISION_HOLD',
    'AI_SOURCE_NOT_AUTOMATIC',
    'DEVICE_NOT_ONLINE_FRESH',
    'DEVICE_NOT_AUTOMATIC',
    'AUTO_CONFIG_NOT_ACKNOWLEDGED',
    'AUTO_WATER_NOT_ENABLED',
    'FIRMWARE_AUTO_AI_ON_UNSUPPORTED',
    'COMPETING_COMMAND_IN_FLIGHT',
    'DEVICE_NOT_ENABLED',
  ])).min(1),
}).strict();

export type AiAutomaticPumpReadiness = z.infer<typeof aiAutomaticPumpReadinessSchema>;
