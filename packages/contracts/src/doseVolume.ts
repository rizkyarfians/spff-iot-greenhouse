import {z} from 'zod';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const liters=z.number().finite().nonnegative().max(10000);
const grams=z.number().finite().nonnegative().max(1e9);
const identity={schemaVersion:z.literal(1),siteId:id,deviceId:id,sessionId:z.string().uuid()};
export const doseVolumeCapabilitySchema=z.object({
 contract:z.literal('spff-dose-volume-v1'),commissioned:z.literal(true),configVersion:z.string().min(1).max(80),
 measuredTotalizers:z.literal(true),waterMeterPosition:z.enum(['before_injector','after_injector']),
 waterStopPct:z.number().finite().min(0).max(99),stockStopPct:z.number().finite().min(0).max(99),
 primeWaterL:z.number().finite().positive().max(100),flushWaterL:z.number().finite().positive().max(100),
 minWaterFlowLpm:z.number().finite().positive().max(10000),minStockFlowLpm:z.number().finite().positive().max(1000),
 maxDurationSec:z.number().int().min(5).max(7200),maxWaterL:z.number().finite().positive().max(10000),
 maxStockL:z.number().finite().positive().max(1000),meterToleranceL:z.number().finite().min(0).max(1),
}).strict();
export type DoseVolumeCapability=z.infer<typeof doseVolumeCapabilitySchema>;
export const waterUntilLowCapabilitySchema=z.object({
 contract:z.literal('spff-water-until-low-v1'),
 maxDurationSec:z.number().int().min(5).max(7200),
}).strict();

export const doseVolumePlanRequestSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('water_only'),requestId:z.string().uuid(),programId:z.string().uuid(),activityId:z.string().regex(/^row-\d+$/)}).strict(),
 z.object({mode:z.literal('fertigation'),requestId:z.string().uuid(),obligationId:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
]);
export type DoseVolumePlanRequest=z.infer<typeof doseVolumePlanRequestSchema>;
export const doseVolumeApproveSchema=z.object({
 planId:z.string().uuid(),approvalId:z.string().uuid(),preparedBatchConfirmed:z.literal(true),
 confirmApplicationRoute:z.boolean().default(false),confirmPastDue:z.boolean().default(false),
}).strict();
export const doseVolumeStopSchema=z.object({requestId:z.string().uuid()}).strict();
export const doseVolumeReconcileSchema=z.object({requestId:z.string().uuid(),pumpsOffVerified:z.literal(true),
 waterVolumeL:liters,stockVolumeL:liters.max(1000),reference:z.string().trim().min(10).max(1000)}).strict();

const commandBase={...identity,kind:z.literal('dose_volume_command'),commandId:z.string().uuid(),
 contract:z.literal('spff-dose-volume-v1'),bootId:z.string().regex(/^[a-fA-F0-9]{16}$/),
 issuedAt:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true})};
export const doseVolumeStartSchema=z.object({...commandBase,commandType:z.literal('start'),
 controlAlgorithm:z.literal('guide_dose_volume_v1'),mode:z.enum(['water_only','fertigation']),planId:z.string().uuid(),
 targetWaterVolumeL:liters.positive(),targetStockVolumeL:liters.max(1000),nominalConcentrationGPerL:grams.max(1000),
 targetMassG:grams,limits:doseVolumeCapabilitySchema,
}).strict().superRefine((v,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:'custom',message});
 if(v.targetWaterVolumeL>v.limits.maxWaterL||v.targetStockVolumeL>v.limits.maxStockL)issue('Target exceeds commissioned limits');
 if(v.targetWaterVolumeL<v.limits.primeWaterL+v.limits.flushWaterL)issue('Priming and flushing do not fit water budget');
 if(v.mode==='water_only'&&(v.targetStockVolumeL!==0||v.nominalConcentrationGPerL!==0||v.targetMassG!==0))issue('Water-only cannot dispense fertilizer');
 if(v.mode==='fertigation'&&(v.targetStockVolumeL<=0||v.nominalConcentrationGPerL<=0||v.targetMassG<=0))issue('Fertigation needs a prepared batch');
 if(Math.abs(v.targetStockVolumeL*v.nominalConcentrationGPerL-v.targetMassG)>Math.max(0.001,v.targetMassG*1e-6))issue('Batch mass and volume disagree');
 const issued=Date.parse(v.issuedAt),expires=Date.parse(v.expiresAt);
 if(expires<=issued||expires-issued>20000)issue('START expiry must be within 20 seconds');
});
export const doseVolumeControlSchema=z.object({...commandBase,commandType:z.literal('stop')}).strict()
 .refine(v=>Date.parse(v.expiresAt)>Date.parse(v.issuedAt)&&Date.parse(v.expiresAt)-Date.parse(v.issuedAt)<=20000,'Invalid STOP expiry');
export const waterUntilLowStartSchema=z.object({...commandBase,commandType:z.literal('start'),
 controlAlgorithm:z.literal('water_until_low_v1'),mode:z.literal('water_only'),planId:z.string().uuid(),
 maxDurationSec:waterUntilLowCapabilitySchema.shape.maxDurationSec,
}).strict().refine(v=>Date.parse(v.expiresAt)>Date.parse(v.issuedAt)&&Date.parse(v.expiresAt)-Date.parse(v.issuedAt)<=20000,'Invalid START expiry');
export const doseVolumeSessionStartSchema=z.union([doseVolumeStartSchema,waterUntilLowStartSchema]);
export const doseVolumeCommandSchema=z.union([doseVolumeSessionStartSchema,doseVolumeControlSchema]);
export type DoseVolumeStart=z.infer<typeof doseVolumeStartSchema>;

export const doseVolumeAckSchema=z.object({...identity,kind:z.literal('dose_volume_ack'),
 contract:z.literal('spff-dose-volume-v1'),bootId:z.string().regex(/^[a-fA-F0-9]{16}$/),commandId:z.string().uuid(),
 timestamp:z.string().datetime({offset:true}),status:z.enum(['accepted','completed','rejected','fault']),
 state:z.enum(['QUEUED','PRIMING','INJECTING','FLUSHING','COMPLETED','STOPPED','FAULT']),reason:z.string().max(200),
}).strict();
export const doseVolumeTelemetrySchema=z.object({...identity,kind:z.literal('dose_volume_telemetry'),
 contract:z.literal('spff-dose-volume-v1'),bootId:z.string().regex(/^[a-fA-F0-9]{16}$/),commandId:z.string().uuid(),
 timestamp:z.string().datetime({offset:true}),
 state:z.enum(['PRIMING','INJECTING','FLUSHING','COMPLETED','STOPPED','FAULT']),
 waterVolumeL:liters,stockVolumeL:liters.max(1000),waterFlowLpm:liters,stockFlowLpm:liters,
 waterPump:z.boolean(),fertPump:z.boolean(),waterPumpKnown:z.boolean(),fertPumpKnown:z.boolean(),
 flowValid:z.boolean(),volumeEstimated:z.boolean(),reason:z.string().max(200),
}).strict();
export const doseVolumeEventPayloadSchema=z.union([doseVolumeAckSchema,doseVolumeTelemetrySchema]);
export type DoseVolumeEventPayload=z.infer<typeof doseVolumeEventPayloadSchema>;

/** Pure recipe planning. No guessed calibration, no EC-to-mass conversion. */
export function calculateDoseVolume(input:{mode:'water_only'|'fertigation';remainingG:number;
 waterAvailableL:number;waterCapacityL:number;stockAvailableL:number|null;stockCapacityL:number;
 limits:DoseVolumeCapability|null}){
 const numbers=[input.remainingG,input.waterAvailableL,input.waterCapacityL,input.stockCapacityL];
 if(numbers.some(n=>!Number.isFinite(n)||n<0)||input.waterCapacityL<=0||input.stockCapacityL<=0
    ||input.waterAvailableL>input.waterCapacityL)throw Error('Invalid inventory or target');
 if(input.mode==='fertigation'&&(!Number.isFinite(input.stockAvailableL)||input.stockAvailableL!<=0
    ||input.stockAvailableL!>input.stockCapacityL||input.remainingG<=0))throw Error('Prepared stock volume and remaining mass are required');
 const concentration=input.mode==='fertigation'?input.remainingG/input.stockAvailableL!:0;
 if(!Number.isFinite(concentration)||concentration>1000)throw Error('Planned concentration exceeds protocol bounds; review batch');
 const waterReserve=input.limits?input.waterCapacityL*input.limits.waterStopPct/100:null;
 const stockReserve=input.limits?input.stockCapacityL*input.limits.stockStopPct/100:null;
 const water=input.limits?Math.max(0,input.waterAvailableL-waterReserve!):null;
 const stock=input.mode==='water_only'?0:input.limits?Math.max(0,input.stockAvailableL!-stockReserve!):null;
 const mass=stock===null?null:stock*concentration;
 return {batchMassG:input.mode==='fertigation'?input.remainingG:0,
  batchVolumeL:input.mode==='fertigation'?input.stockAvailableL:0,nominalConcentrationGPerL:concentration,
  waterInventoryL:input.waterAvailableL,waterReserveL:waterReserve,stockReserveL:stockReserve,
  targetWaterL:water,targetStockL:stock,plannedMassG:mass,
  remainingAfterSessionG:mass===null?null:Math.max(0,input.remainingG-mass),
  massBasis:'OPERATOR_CONFIRMED_RECIPE_AND_MEASURED_STOCK_VOLUME' as const};
}
