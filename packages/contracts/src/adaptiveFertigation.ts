import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),uuid=z.string().uuid(),num=z.number().finite().nonnegative().max(1e9);
const identity={schemaVersion:z.literal(1),siteId:id,deviceId:id,sessionId:uuid};
export const adaptiveStateSchema=z.enum(['IDLE','PRECHECK','WATER_PRIME','EC_CONTROL','NUTRIENT_COMPLETE','FLUSHING','COMPLETED','PAUSED','FAULT']);
const base={...identity,kind:z.literal('adaptive_fert_command'),commandId:uuid};
const startFields={...base,commandType:z.literal('start'),targetEcUs:z.number().finite().gt(100).lt(8000),ecToleranceUs:z.number().finite().min(20).max(500),maxDurationSec:z.number().int().min(60).max(7200),targetWaterVolumeL:z.number().finite().min(10).max(10000),targetFertVolumeL:z.number().finite().min(1).max(1000),nominalConcentrationGPerL:z.number().finite().positive().max(1000),plantCount:z.number().int().positive().max(1e7),flushDurationSec:z.number().int().min(10).max(600)};
const validity={bootId:z.string().min(1).max(128),issuedAt:z.string().datetime(),expiresAt:z.string().datetime()};
function checkValidity(value:{issuedAt:string;expiresAt:string},ctx:z.RefinementCtx){
 const duration=Date.parse(value.expiresAt)-Date.parse(value.issuedAt);
 if(duration<=0||duration>300000)ctx.addIssue({code:'custom',path:['expiresAt'],message:'Command lifetime must be positive and at most 300 seconds.'});
}
// Preview plans have no live boot binding and can never pass the dispatch schema.
export const adaptiveStartPlanSchema=z.object(startFields).strict().refine(v=>v.ecToleranceUs<v.targetEcUs,'Toleransi EC tidak valid.');
export const adaptiveStartCommandSchema=z.object({...startFields,...validity}).strict().refine(v=>v.ecToleranceUs<v.targetEcUs,'Toleransi EC tidak valid.').superRefine(checkValidity);
export const adaptiveResumeCommandSchema=z.object({...base,commandType:z.literal('resume'),...validity}).strict().superRefine(checkValidity);
export const adaptiveControlCommandSchema=z.union([z.object({...base,commandType:z.enum(['pause','stop'])}).strict(),adaptiveResumeCommandSchema]);
export const adaptiveCommandSchema=z.union([adaptiveStartCommandSchema,adaptiveControlCommandSchema]);
export type AdaptiveCommand=z.infer<typeof adaptiveCommandSchema>;
export const adaptiveDispatchSchema=z.object({kind:z.literal('adaptive_fert_dispatch'),schemaVersion:z.literal(1),siteId:id,deviceId:id,command:adaptiveCommandSchema,expiresAt:z.string().datetime()}).strict().refine(v=>v.siteId===v.command.siteId&&v.deviceId===v.command.deviceId,'Device mismatch').refine(v=>!('expiresAt' in v.command)||Date.parse(v.expiresAt)<=Date.parse(v.command.expiresAt),'Dispatch cannot extend firmware command expiry.');
export type AdaptiveDispatch=z.infer<typeof adaptiveDispatchSchema>;
// Some rejected firmware ACKs contain empty IDs. Preserve them as diagnostics, never correlate to a command.
export const adaptiveAckSchema=z.object({...identity,sessionId:z.string().max(36),kind:z.literal('adaptive_fert_ack'),commandId:z.string().max(36),state:adaptiveStateSchema,status:z.enum(['accepted','in_progress','completed','rejected','fault']),acknowledgedAt:z.string().datetime({offset:true}),reason:z.string().max(200)}).strict();
export const adaptiveTelemetrySchema=z.object({...identity,sessionId:z.union([uuid,z.literal('')]),kind:z.literal('adaptive_fert_telemetry'),timestamp:z.string().datetime({offset:true}),state:adaptiveStateSchema,filteredEc:num,rawEc:num,waterFlowLpm:num,fertFlowLpm:num,waterVolumeL:num,fertVolumeL:num,fertMassGrams:num,volumePerPlantMl:num,waterPump:z.boolean(),fertPump:z.boolean(),faultReason:z.string().max(200),ecTargetUnreachable:z.boolean(),
 // Optional for legacy diagnostic frames; valid 1.5.03 measurement evidence is
 // checked by the session ingester before any dose total can advance.
 ecValid:z.boolean().optional(),flowValid:z.boolean().optional(),ecAgeMs:z.number().int().min(0).max(0xffffffff).optional(),flowAgeMs:z.number().int().min(0).max(0xffffffff).optional(),waterPumpKnown:z.boolean().optional(),fertPumpKnown:z.boolean().optional(),volumeEstimated:z.boolean().optional(),targetEcUs:num.optional(),bootId:z.string().min(1).max(128).optional(),controlAlgorithm:z.string().max(80).optional(),firmwareVersion:z.string().max(128).optional()
}).strict().refine(v=>v.sessionId!==''||v.state==='IDLE','Empty session ID is only valid for IDLE diagnostics.');
export const adaptiveGatewayAckSchema=z.object({...identity,kind:z.literal('adaptive_fert_gateway_ack'),commandId:uuid,status:z.enum(['forwarded','expired','unknown']),timestamp:z.string().datetime(),reason:z.string().max(200)}).strict();
export const adaptiveEventPayloadSchema=z.union([adaptiveAckSchema,adaptiveTelemetrySchema,adaptiveGatewayAckSchema]);
export const adaptiveEventSchema=z.object({kind:z.literal('adaptive_fert_event'),schemaVersion:z.literal(1),siteId:id,deviceId:id,messageId:z.string().regex(/^[a-f0-9]{64}$/),receivedAt:z.string().datetime(),payload:adaptiveEventPayloadSchema}).strict().refine(v=>v.siteId===v.payload.siteId&&v.deviceId===v.payload.deviceId,'Device mismatch');
export type AdaptiveEvent=z.infer<typeof adaptiveEventSchema>;
export const adaptivePersistedSchema=z.object({kind:z.literal('adaptive_fert_persisted_ack'),schemaVersion:z.literal(1),siteId:id,deviceId:id,messageId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type AdaptivePersisted=z.infer<typeof adaptivePersistedSchema>;
export const adaptiveSessionInputSchema=z.object({programId:uuid,expectedProfileRevision:z.number().int().positive().optional(),expectedProgramRevision:z.number().int().positive(),activityId:z.string().regex(/^row-\d+$/),requestId:uuid,waterMeterPosition:z.enum(['before_injector','after_injector']),waterVolumeL:z.number().finite().min(10).max(10000),stockConcentrationGPerL:z.number().finite().positive().max(1000),ecToleranceUs:z.number().finite().min(20).max(500),maxDurationSec:z.number().int().min(60).max(7200),flushDurationSec:z.number().int().min(10).max(600),hydraulicsReference:z.string().trim().min(5).max(1000)}).strict();
export type AdaptiveSessionInput=z.infer<typeof adaptiveSessionInputSchema>;
export const adaptiveSessionControlSchema=z.object({requestId:uuid,operation:z.enum(['pause','resume','stop'])}).strict();
export const adaptiveReconcileSchema=z.object({pumpsOffVerified:z.literal(true),waterVolumeL:num,fertVolumeL:num,note:z.string().trim().min(10).max(1000)}).strict();
