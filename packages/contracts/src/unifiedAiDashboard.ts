/** Read-only public-safe presentation contract for the standalone Python AI.
 * Source is a stored, non-simulated SHADOW decision; not an actuation grant.
 */
import { z } from 'zod';

const str = z.string().max(200);
const nullableStr = str.nullable();
const num = z.number().finite().nonnegative().nullable();
const booleanNull = z.boolean().nullable();
const reasons = z.array(str).max(80);

const product = z.object({
  product: str, source_row: z.number().int().positive().nullable(),
  is_fertilizer: z.boolean(), amount: num, unit: nullableStr,
  target_mass_g: num, credited_mass_g: num, remaining_mass_g: num,
  ledger_status: nullableStr, requires_review: z.boolean(),
  review_reasons: reasons,
}).strict();

const flowReference = z.object({
  basis: z.literal('UNVERIFIED_HISTORICAL_COUNTER_DELTAS'),
  water_lpm: z.number().finite().positive(),
  stock_lpm: z.number().finite().positive(),
  water_delta_l: z.number().finite().positive(),
  stock_delta_l: z.number().finite().positive(),
  duration_seconds: z.number().finite().positive(),
  interval_count: z.number().int().min(3),
  started_at: str,
  ended_at: str,
}).strict();

const planningProductOption = z.object({
  source_row: z.number().int().positive().nullable(),
  product: str,
  mass_g: num,
  stock_l: num,
  stock_duration_minutes: num,
  reasons: reasons,
}).strict();

const planningPreview = z.object({
  basis: z.literal('GUIDE_WITH_UNVERIFIED_HISTORICAL_FLOW'),
  water_l: num,
  water_source: z.enum(['GUIDE', 'OPERATOR_INPUT', 'FUZZY_SIMULATION']).nullable(),
  fertilizer_mass_g: num,
  stock_l: num,
  water_duration_minutes: num,
  stock_duration_minutes: num,
  stock_concentration_g_l: num,
  flow_reference: flowReference.nullable(),
  product_options: z.array(planningProductOption).max(30),
  reasons: reasons,
  can_dispatch: z.literal(false),
}).strict();

const activity = z.object({
  activity_id: str, title: str, hst: z.number().int().nullable(),
  application_date: nullableStr, calendar_status: str,
  method: nullableStr, reference_water_l: num,
  manually_completed: z.boolean(), products: z.array(product).max(30),
  planning_preview: planningPreview,
}).strict();

const program = z.object({
  program_id: str, crop_name: str, current_hst: z.number().int().nullable(),
  plant_count: num, planting_date: nullableStr, status: str,
  hold_reasons: reasons, activities: z.array(activity).max(120),
}).strict();

export const unifiedAiDashboardSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal('SHADOW_MODE'),
  can_dispatch: z.literal(false),
  status: z.enum(['CURRENT', 'STALE', 'NO_DECISION']),
  evaluated_at: nullableStr,
  planning_source: z.enum(['POSTGRES_READ_ONLY','DECISION_SNAPSHOT']),
  planning_status: z.enum(['CURRENT','STALE','UNAVAILABLE']),
  planning_recorded_at: nullableStr,
  decision: z.object({
    type: nullableStr, proposed_action: nullableStr,
    hold_reasons: reasons, configuration_version: nullableStr,
  }).strict(),
  feedback: z.object({
    status: str, reported_off: z.boolean(), boot_matches: z.boolean(),
    water_pump: booleanNull, fert_pump: booleanNull,
    reported_at: nullableStr,
  }).strict(),
  sensors: z.object({
    recorded_at: nullableStr, soil_moisture_pct: num,
    soil_2_moisture_pct: num,
    soil_1_valid: booleanNull, soil_2_valid: booleanNull,
    control_moisture_source: z.enum(['soil_1_moisture', 'soil_2_moisture']).nullable(),
    water_tank_pct: num, stock_tank_pct: num, device_mode: nullableStr,
  }).strict(),
  calculation: z.object({
    water_l: num, stock_l: num, fertilizer_mass_g: num,
    duration_seconds: num, fuzzy_score: num,
  }).strict(),
  fuzzy_preview: z.object({
    basis: z.literal('SIMULATION_PROFILE'),
    config_version: str,
    input_key: z.enum(['soil_1_moisture','soil_2_moisture']),
    moisture_pct: z.number().min(0).max(100),
    score: num,
    illustrative_water_l: num,
    model_max_irrigation_l: num,
    recorded_at: nullableStr,
  }).strict().nullable(),
  fuzzy_preview_blockers: z.array(z.enum(['no_source_decision','simulation_profile_unavailable','control_source_not_selected','selected_sensor_value_missing','selected_sensor_health_invalid','sensor_control_diagnostic_rejected','sensor_raw_poll_not_verified','sensor_poll_boot_missing','sensor_raw_value_unverified','sensor_raw_age_unverified','control_config_not_acknowledged','sensor_timestamp_missing','simulation_rules_invalid'])).max(20),
  programs: z.array(program).max(30),
  note: z.string().max(500),
}).strict();

export type UnifiedAiDashboard = z.infer<typeof unifiedAiDashboardSchema>;
