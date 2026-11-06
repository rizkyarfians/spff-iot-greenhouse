import {z} from 'zod';
import {doseVolumeCommandSchema,doseVolumeEventPayloadSchema} from './doseVolume.js';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),uuid=z.string().uuid(),num=z.number().finite().nonnegative().max(1e9);
const identity={schemaVersion:z.literal(1),siteId:id,deviceId:id,sessionId:uuid};
export const adaptiveStateSchema=z.enum(['IDLE','PRECHECK','WATER_PRIME','EC_CONTROL','NUTRIENT_COMPLETE','FLUSHING','COMPLETED','PAUSED','FAULT']);
const base={...identity,kind:z.literal('adaptive_fert_command'),commandId:uuid};
export const adaptiveStartCommandSchema=z.object({...base,commandType:z.literal('start'),targetEcUs:z.number().finite().gt(100).lt(8000),ecToleranceUs:z.number().finite().min(20).max(500),maxDurationSec:z.number().int().min(60).max(7200),targetWaterVolumeL:z.number().finite().min(10).max(10000),targetFertVolumeL:z.number().finite().min(1).max(1000),nominalConcentrationGPerL:z.number().finite().positive().max(1000),plantCount:z.number().int().positive().max(1e7),flushDurationSec:z.number().int().min(10).max(600)}).strict().refine(v=>v.ecToleranceUs<v.targetEcUs,'Toleransi EC tidak valid.');
/** Firmware v1.5.07 requires a fresh MCU boot identity and bounded UTC window
 * for physical START. The planning-only adaptiveStartCommandSchema above MUST
 * NOT be used directly by an Edge/MQTT dispatcher.
 */
export const adaptiveFirmware1507StartSchema=adaptiveStartCommandSchema.safeExtend({
 bootId:z.string().regex(/^[a-fA-F0-9]{16}$/),
 issuedAt:z.string().datetime({offset:true}),
 expiresAt:z.string().datetime({offset:true}),
}).strict().refine(c=>{
 const issued=Date.parse(c.issuedAt),expires=Date.parse(c.expiresAt);
 return Number.isFinite(issued)&&Number.isFinite(expires)&&expires>issued&&expires-issued<=300000;
},'Waktu command adaptif tidak valid atau melebihi batas firmware.');
export const adaptiveControlCommandSchema=z.object({...base,commandType:z.enum(['pause','resume','stop'])}).strict();
export const adaptiveCommandSchema=z.union([adaptiveStartCommandSchema,adaptiveControlCommandSchema]);
export type AdaptiveCommand=z.infer<typeof adaptiveCommandSchema>;
// Hardware dispatch refuses unbound preview START, even if it is otherwise a
// valid calculation. STOP/pause retain the existing firmware contract.
export const adaptiveDispatchSchema=z.object({kind:z.literal('adaptive_fert_dispatch'),schemaVersion:z.literal(1),siteId:id,deviceId:id,command:z.union([adaptiveFirmware1507StartSchema,adaptiveControlCommandSchema,doseVolumeCommandSchema]),expiresAt:z.string().datetime({offset:true})}).strict()
 .refine(v=>v.siteId===v.command.siteId&&v.deviceId===v.command.deviceId,'Device mismatch')
 .refine(v=>v.command.commandType!=='start'||Date.parse(v.expiresAt)===Date.parse(v.command.expiresAt),'START expiry must match persisted dispatch expiry');
export type AdaptiveDispatch=z.infer<typeof adaptiveDispatchSchema>;
// Some rejected firmware ACKs contain empty IDs. Preserve them as diagnostics, never correlate to a command.
export const adaptiveAckSchema=z.object({...identity,sessionId:z.string().max(36),kind:z.literal('adaptive_fert_ack'),commandId:z.string().max(36),state:adaptiveStateSchema,status:z.enum(['accepted','in_progress','completed','rejected','fault']),acknowledgedAt:z.string().datetime({offset:true}),reason:z.string().max(200)}).strict();
export const adaptiveTelemetrySchema=z.object({...identity,kind:z.literal('adaptive_fert_telemetry'),timestamp:z.string().datetime({offset:true}),state:adaptiveStateSchema,filteredEc:num,rawEc:num,waterFlowLpm:num,fertFlowLpm:num,waterVolumeL:num,fertVolumeL:num,fertMassGrams:num,volumePerPlantMl:num,waterPump:z.boolean(),fertPump:z.boolean(),faultReason:z.string().max(200),ecTargetUnreachable:z.boolean(),
 // Actual firmware 1.5.07 (AdaptiveFertigationEngine.h) emits diagnostics in
 // addition to the legacy measurement fields. Reject unknown keys, but accept
 // these observed fields without losing device evidence.
 ecValid:z.boolean().optional(),flowValid:z.boolean().optional(),
 ecAgeMs:z.number().int().nonnegative().optional(),flowAgeMs:z.number().int().nonnegative().optional(),
 waterPumpKnown:z.boolean().optional(),fertPumpKnown:z.boolean().optional(),
 volumeEstimated:z.boolean().optional(),targetEcUs:num.optional(),
 bootId:z.string().regex(/^[a-fA-F0-9]{16}$/).optional(),
 controlAlgorithm:z.literal('ec_hysteresis_ema').optional(),
 firmwareVersion:z.string().min(1).optional(),
}).strict();
export const adaptiveGatewayAckSchema=z.object({...identity,kind:z.literal('adaptive_fert_gateway_ack'),commandId:uuid,status:z.enum(['forwarded','expired','unknown']),timestamp:z.string().datetime(),reason:z.string().max(200)}).strict();
export const waterFirstCompletionSchema=z.object({...identity,kind:z.literal('water_first_fertigation_completed'),
 bootId:z.string().regex(/^[a-fA-F0-9]{16}$/),timestamp:z.string().datetime({offset:true}),
 waterPump:z.object({active:z.literal(false),onDurationMs:z.number().int().nonnegative().safe()}).strict(),
 fertilizerPump:z.object({active:z.literal(false),onDurationMs:z.number().int().nonnegative().safe()}).strict(),
 reason:z.string().trim().min(1).max(200),
}).strict();
export const adaptiveEventPayloadSchema=z.union([adaptiveAckSchema,adaptiveTelemetrySchema,adaptiveGatewayAckSchema,doseVolumeEventPayloadSchema,waterFirstCompletionSchema]);
export const adaptiveEventSchema=z.object({kind:z.literal('adaptive_fert_event'),schemaVersion:z.literal(1),siteId:id,deviceId:id,messageId:z.string().regex(/^[a-f0-9]{64}$/),receivedAt:z.string().datetime(),payload:adaptiveEventPayloadSchema}).strict().refine(v=>v.siteId===v.payload.siteId&&v.deviceId===v.payload.deviceId,'Device mismatch');
export type AdaptiveEvent=z.infer<typeof adaptiveEventSchema>;
export const adaptivePersistedSchema=z.object({kind:z.literal('adaptive_fert_persisted_ack'),schemaVersion:z.literal(1),siteId:id,deviceId:id,messageId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type AdaptivePersisted=z.infer<typeof adaptivePersistedSchema>;
export const adaptiveSessionInputSchema=z.object({programId:uuid,expectedProfileRevision:z.number().int().positive().optional(),expectedProgramRevision:z.number().int().positive(),activityId:z.string().regex(/^row-\d+$/),requestId:uuid,waterMeterPosition:z.enum(['before_injector','after_injector']),waterVolumeL:z.number().finite().min(10).max(10000),stockConcentrationGPerL:z.number().finite().positive().max(1000),ecToleranceUs:z.number().finite().min(20).max(500),maxDurationSec:z.number().int().min(60).max(7200),flushDurationSec:z.number().int().min(10).max(600),hydraulicsReference:z.string().trim().min(5).max(1000)}).strict();
export type AdaptiveSessionInput=z.infer<typeof adaptiveSessionInputSchema>;
export const adaptiveSessionControlSchema=z.object({requestId:uuid,operation:z.enum(['pause','resume','stop'])}).strict();
export const adaptiveReconcileSchema=z.object({pumpsOffVerified:z.literal(true),waterVolumeL:num,fertVolumeL:num,note:z.string().trim().min(10).max(1000)}).strict();
