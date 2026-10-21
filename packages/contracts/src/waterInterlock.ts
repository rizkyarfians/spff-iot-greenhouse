import { z } from 'zod';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const revision = z.number().int().min(0).max(2147483647);
export const waterInterlockSyncSchema = z.object({
  kind: z.literal('water_interlock_sync'), schemaVersion: z.literal(1),
  siteId: id, deviceId: id, revision: revision.min(1), enabled: z.boolean(),
}).strict();
export const waterInterlockAckSchema = z.object({
  kind: z.literal('water_interlock_ack'), schemaVersion: z.literal(1),
  siteId: id, deviceId: id, revision: revision.min(1),
  status: z.enum(['applied', 'rejected']), appliedRevision: revision,
  enabled: z.boolean(), acknowledgedAt: z.string().datetime({offset:true}),
  reason: z.string().min(1).max(200),
}).strict().refine(v=>v.status!=='applied'||v.appliedRevision===v.revision,'Applied revision mismatch');
export const waterInterlockUpdateSchema = z.object({
  deviceId:id, expectedRevision:revision, enabled:z.boolean(),
}).strict();
export type WaterInterlockSync = z.infer<typeof waterInterlockSyncSchema>;
export type WaterInterlockAck = z.infer<typeof waterInterlockAckSchema>;
export interface WaterInterlockView {
  deviceId:string; revision:number; enabled:boolean;
  acknowledgedRevision:number|null; acknowledgementStatus:'applied'|'rejected'|null;
  appliedEnabled:boolean|null; acknowledgedAt:string|null; reason:string|null;
  capable:boolean; online:boolean;
  reportedEnabled:boolean|null; reportedRevision:number|null;
}
