import { z } from 'zod';
import { cropIdSchema } from './smartSoil.js';

const finite = z.number().finite();
const percent = finite.min(0).max(100);
const limitedId = z.string().trim().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const reference = z.string().trim().min(5).max(500);

/**
 * SPFF recipe values must come from an explicitly reviewed agronomic source.
 * The protocol workbook is a reference, not a validated Venturi dosing recipe.
 */
export const fertigationRecipeInputSchema = z.object({
  cropName: z.string().trim().min(2).max(100),
  hstFrom: z.number().int().min(0).max(1000),
  hstTo: z.number().int().min(0).max(1000),
  targetWaterL: finite.positive().max(100000),
  targetStockL: finite.min(0).max(100000),
  fertilizerName: z.string().trim().min(1).max(120).nullable(),
  stockConcentrationGPerL: finite.positive().max(10000).nullable(),
  minWaterTankPercent: percent,
  minStockTankPercent: percent,
  sourceReference: reference,
}).strict().superRefine((value, ctx) => {
  if (value.hstFrom > value.hstTo) {
    ctx.addIssue({ code: 'custom', path: ['hstTo'], message: 'HST akhir harus >= HST awal.' });
  }
  if (value.targetStockL > 0 && (value.fertilizerName === null || value.stockConcentrationGPerL === null)) {
    ctx.addIssue({ code: 'custom', path: ['targetStockL'], message: 'Dosis stok membutuhkan nama pupuk dan konsentrasi stok tervalidasi.' });
  }
  if (value.targetStockL === 0 && (value.fertilizerName !== null || value.stockConcentrationGPerL !== null)) {
    ctx.addIssue({ code: 'custom', path: ['fertilizerName'], message: 'Resep air saja tidak boleh memuat konsentrasi pupuk.' });
  }
});
export type FertigationRecipeInput = z.infer<typeof fertigationRecipeInputSchema>;

export const fertigationRecipeSchema = fertigationRecipeInputSchema.safeExtend({
  recipeId: z.string().uuid(),
  siteId: limitedId,
  zoneId: z.literal('soil-1'),
  cropId: cropIdSchema.nullable(),
  approvalStatus: z.enum(['draft', 'approved']),
  approvalReference: reference.nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().datetime({ offset: true }).nullable(),
  plantingDate: z.iso.date().nullable(),
  applicationDate: z.iso.date().nullable(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type FertigationRecipe = z.infer<typeof fertigationRecipeSchema>;

export const fertigationSimulationInputSchema = z.object({
  recipeId: z.string().uuid(),
  deviceId: limitedId,
  hst: z.number().int().min(0).max(1000),
  scheduleDue: z.boolean(),
  selectorMode: z.enum(['manual', 'automatic']),
  observedAt: z.string().datetime({ offset: true }),
  slaveFresh: z.boolean(),
  waterFlowHealthy: z.boolean(),
  stockFlowHealthy: z.boolean(),
  waterTankPercent: percent.nullable(),
  stockTankPercent: percent.nullable(),
}).strict();
export type FertigationSimulationInput = z.infer<typeof fertigationSimulationInputSchema>;

export const fertigationDecisionSchema = z.object({
  modelId: z.literal('rule-based-v1'),
  simulationOnly: z.literal(true),
  status: z.enum(['hold', 'suggested']),
  action: z.enum(['DELAY', 'IRRIGATE', 'FERTIGATE']),
  targetWaterL: finite.nonnegative().nullable(),
  targetStockL: finite.nonnegative().nullable(),
  reasons: z.array(z.string().min(1)),
  requiresApproval: z.literal(true),
  publishable: z.literal(false),
}).strict();
export type FertigationDecision = z.infer<typeof fertigationDecisionSchema>;

/**
 * Reserved for future actual device-origin session ingestion.
 * Never derive 'completed' from MQTT publish or a server-side simulation.
 */
export const fertigationSessionEventSchema = z.object({
  kind: z.literal('fertigation_session_event'),
  schemaVersion: z.literal(1),
  siteId: limitedId,
  deviceId: limitedId,
  messageId: z.string().trim().min(1).max(128),
  sequence: z.number().int().nonnegative(),
  sessionId: z.string().uuid(),
  recordedAt: z.string().datetime({ offset: true }),
  status: z.enum(['started', 'running', 'completed', 'aborted', 'fault']),
  targetWaterL: finite.positive(),
  targetStockL: finite.nonnegative(),
  actualWaterL: finite.nonnegative().nullable(),
  actualStockL: finite.nonnegative().nullable(),
  pumpsOff: z.boolean(),
  completionReason: z.string().trim().min(1).max(200).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'completed' && (!value.pumpsOff || value.actualWaterL === null || value.actualStockL === null)) {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'Completed memerlukan status pompa OFF dan pembacaan final volume.' });
  }
});
export type FertigationSessionEvent = z.infer<typeof fertigationSessionEventSchema>;

/** Only IDs from the HTTP request; all sensor values originate from PostgreSQL. */
export const fertigationLiveEvaluationInputSchema = z.object({
  recipeId: z.string().uuid(),
  deviceId: limitedId,
}).strict();
export type FertigationLiveEvaluationInput = z.infer<typeof fertigationLiveEvaluationInputSchema>;

export const fertigationRecipeMutationSchema = fertigationRecipeInputSchema.safeExtend({
  cropId: cropIdSchema,
  plantingDate: z.iso.date().nullable(),
  applicationDate: z.iso.date().nullable(),
}).strict();
export type FertigationRecipeMutation = z.infer<typeof fertigationRecipeMutationSchema>;

export const fertigationRecipeUpdateSchema = fertigationRecipeMutationSchema.safeExtend({
  expectedRevision: z.number().int().positive(),
}).strict();
export type FertigationRecipeUpdate = z.infer<typeof fertigationRecipeUpdateSchema>;

export const fertigationRecipeApprovalSchema = z.object({
  expectedRevision: z.number().int().positive(),
  approvalReference: reference,
}).strict();
export type FertigationRecipeApproval = z.infer<typeof fertigationRecipeApprovalSchema>;

export const fertigationLiveDecisionSchema = z.object({
  recipeId: z.string().uuid(),
  deviceId: limitedId,
  source: z.literal('site-postgresql'),
  siteObservedAt: z.string().datetime({ offset: true }),
  hst: z.number().int().nullable(),
  telemetryRecordedAt: z.string().datetime({ offset: true }).nullable(),
  deviceRecordedAt: z.string().datetime({ offset: true }).nullable(),
  activeCropId: cropIdSchema.nullable(),
  observations: z.object({
    moistureSensorKey: z.enum(['soil_1_moisture', 'soil_2_moisture']).nullable(),
    soilMoisturePercent: percent.nullable(),
    liquidEcUsCm: finite.nonnegative().nullable(),
  }).strict(),
  controlStrategy: z.object({
    active: z.literal('legacy_sensor'),
    deviceAuthority: z.literal('esp32'),
    recipeMode: z.literal('advisory_only'),
    canDispatch: z.literal(false),
    reason: z.string().min(1),
  }).strict(),
  decision: fertigationDecisionSchema,
}).strict();
export type FertigationLiveDecision = z.infer<typeof fertigationLiveDecisionSchema>;
