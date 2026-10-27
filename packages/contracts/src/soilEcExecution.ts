import { z } from 'zod';

export const soilEcExecutionUpdateSchema = z.object({
  deviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().min(0).max(2147483646),
  enabled: z.boolean(),
}).strict();

export type SoilEcExecutionView = {
  deviceId: string;
  enabled: boolean;
  revision: number;
  installed: boolean;
  serverAvailable: boolean;
  capable: boolean;
  firmware: string | null;
  // Saved permission is not proof of relay OFF; these sessions need an OFF ACK.
  unconfirmedStopSessions: number;
};
